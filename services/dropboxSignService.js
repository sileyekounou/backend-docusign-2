const DropboxSign = require("@dropbox/sign");
const fs = require("fs").promises;
const path = require("path");

class DropboxSignService {
  constructor() {
    // Initialiser le client Dropbox Sign
    this.client = new DropboxSign.SignatureRequestApi();
    this.client.username = process.env.DROPBOX_SIGN_API_KEY;

    this.accountApi = new DropboxSign.AccountApi();
    this.accountApi.username = process.env.DROPBOX_SIGN_API_KEY;

    this.templateApi = new DropboxSign.TemplateApi();
    this.templateApi.username = process.env.DROPBOX_SIGN_API_KEY;

    this.teamApi = new DropboxSign.TeamApi();
    this.teamApi.username = process.env.DROPBOX_SIGN_API_KEY;

    // Configuration par défaut
    this.defaultOptions = {
      testMode: process.env.NODE_ENV !== "production",
      useTextTags: true,
      hideTextTags: true,
      allowDecline: true,
      allowReassign: false,
    };
  }

  /**
   * Créer une demande de signature simple
   */
  async creerDemandeSignature(options) {
    try {
      const {
        titre,
        message,
        fichiers,
        signataires,
        documentId,
        options: customOptions = {},
      } = options;

      // Préparer les signataires
      const signersData = signataires.map((signataire, index) => {
        return DropboxSign.SubSigningOptions.init({
          emailAddress: signataire.email,
          name: `${signataire.prenom} ${signataire.nom}`,
          order: signataire.ordre || index + 1,
          pin: signataire.pin || null,
          smsPhoneNumber: signataire.telephone || null,
        });
      });

      // Préparer les fichiers
      const filesData = [];
      for (const fichier of fichiers) {
        try {
          const fileBuffer = await fs.readFile(fichier.chemin);
          filesData.push({
            name: fichier.nomOriginal,
            file: fileBuffer,
          });
        } catch (error) {
          console.error(`Erreur lecture fichier ${fichier.chemin}:`, error);
          throw new Error(
            `Impossible de lire le fichier ${fichier.nomOriginal}`
          );
        }
      }

      // Créer la demande de signature
      const signatureRequest = DropboxSign.SignatureRequestSendRequest.init({
        title: titre,
        subject: titre,
        message: message || `Veuillez signer le document: ${titre}`,
        signers: signersData,
        files: filesData,
        testMode: customOptions.testMode ?? this.defaultOptions.testMode,
        useTextTags:
          customOptions.useTextTags ?? this.defaultOptions.useTextTags,
        hideTextTags:
          customOptions.hideTextTags ?? this.defaultOptions.hideTextTags,
        allowDecline:
          customOptions.allowDecline ?? this.defaultOptions.allowDecline,
        allowReassign:
          customOptions.allowReassign ?? this.defaultOptions.allowReassign,
        clientId: process.env.DROPBOX_SIGN_CLIENT_ID,
        metadata: {
          document_id: documentId,
          platform: "signature-platform",
        },
      });

      const response = await this.client.signatureRequestSend(signatureRequest);

      return {
        success: true,
        data: {
          signatureRequestId: response.body.signatureRequest.signatureRequestId,
          signers: response.body.signatureRequest.signatures.map((sig) => ({
            signerId: sig.signatureId,
            email: sig.signerEmailAddress,
            name: sig.signerName,
            statusCode: sig.statusCode,
            signUrl: sig.signUrl,
            detailsUrl: sig.detailsUrl,
          })),
        },
      };
    } catch (error) {
      console.error("Erreur création demande signature:", error);
      return {
        success: false,
        error:
          error.message ||
          "Erreur lors de la création de la demande de signature",
      };
    }
  }

  /**
   * Créer une demande de signature intégrée (embedded)
   */
  async creerDemandeSignatureIntegree(options) {
    try {
      const {
        titre,
        message,
        fichiers,
        signataires,
        documentId,
        urlRetour,
        options: customOptions = {},
      } = options;

      // Préparer les signataires pour signature intégrée
      const signersData = signataires.map((signataire, index) => {
        return DropboxSign.SubSigningOptions.init({
          emailAddress: signataire.email,
          name: `${signataire.prenom} ${signataire.nom}`,
          order: signataire.ordre || index + 1,
          pin: signataire.pin || null,
        });
      });

      // Préparer les fichiers
      const filesData = [];
      for (const fichier of fichiers) {
        const fileBuffer = await fs.readFile(fichier.chemin);
        filesData.push({
          name: fichier.nomOriginal,
          file: fileBuffer,
        });
      }

      // Créer la demande de signature intégrée
      const embeddedRequest =
        DropboxSign.SignatureRequestCreateEmbeddedRequest.init({
          title: titre,
          subject: titre,
          message: message || `Veuillez signer le document: ${titre}`,
          signers: signersData,
          files: filesData,
          testMode: customOptions.testMode ?? this.defaultOptions.testMode,
          clientId: process.env.DROPBOX_SIGN_CLIENT_ID,
          metadata: {
            document_id: documentId,
            platform: "signature-platform",
          },
        });

      const response = await this.client.signatureRequestCreateEmbedded(
        embeddedRequest
      );

      // Générer les URLs de signature intégrée
      const embeddedApi = new DropboxSign.EmbeddedApi();
      embeddedApi.username = process.env.DROPBOX_SIGN_API_KEY;

      const signUrls = [];
      for (const signature of response.body.signatureRequest.signatures) {
        const urlRequest = DropboxSign.EmbeddedSignUrlRequest.init({
          signatureId: signature.signatureId,
        });

        const urlResponse = await embeddedApi.embeddedSignUrl(urlRequest);
        signUrls.push({
          signerId: signature.signatureId,
          email: signature.signerEmailAddress,
          signUrl: urlResponse.body.embedded.signUrl,
          expiresAt: urlResponse.body.embedded.expiresAt,
        });
      }

      return {
        success: true,
        data: {
          signatureRequestId: response.body.signatureRequest.signatureRequestId,
          signUrls,
        },
      };
    } catch (error) {
      console.error("Erreur création demande signature intégrée:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Obtenir le statut d'une demande de signature
   */
  async obtenirStatutDemande(signatureRequestId) {
    try {
      const response = await this.client.signatureRequestGet(
        signatureRequestId
      );
      const signatureRequest = response.body.signatureRequest;

      return {
        success: true,
        data: {
          signatureRequestId: signatureRequest.signatureRequestId,
          title: signatureRequest.title,
          subject: signatureRequest.subject,
          message: signatureRequest.message,
          isComplete: signatureRequest.isComplete,
          isDeclined: signatureRequest.isDeclined,
          hasError: signatureRequest.hasError,
          signatures: signatureRequest.signatures.map((sig) => ({
            signatureId: sig.signatureId,
            signerEmailAddress: sig.signerEmailAddress,
            signerName: sig.signerName,
            order: sig.order,
            statusCode: sig.statusCode,
            declineReason: sig.declineReason,
            signedAt: sig.signedAt,
            lastViewedAt: sig.lastViewedAt,
            lastRemindedAt: sig.lastRemindedAt,
            error: sig.error,
          })),
          responseData: signatureRequest.responseData,
        },
      };
    } catch (error) {
      console.error("Erreur obtention statut:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Télécharger le document signé
   */
  async telechargerDocumentSigne(signatureRequestId, destinationPath) {
    try {
      const response = await this.client.signatureRequestFiles(
        signatureRequestId,
        "pdf"
      );

      // Sauvegarder le fichier
      await fs.writeFile(destinationPath, response.body);

      return {
        success: true,
        data: {
          filePath: destinationPath,
          size: response.body.length,
        },
      };
    } catch (error) {
      console.error("Erreur téléchargement document:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Envoyer un rappel
   */
  async envoyerRappel(signatureRequestId, signerEmail) {
    try {
      const reminderRequest = DropboxSign.SignatureRequestRemindRequest.init({
        signatureRequestId,
        emailAddress: signerEmail,
      });

      await this.client.signatureRequestRemind(reminderRequest);

      return {
        success: true,
        message: "Rappel envoyé avec succès",
      };
    } catch (error) {
      console.error("Erreur envoi rappel:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Annuler une demande de signature
   */
  async annulerDemande(signatureRequestId) {
    try {
      await this.client.signatureRequestCancel(signatureRequestId);

      return {
        success: true,
        message: "Demande de signature annulée",
      };
    } catch (error) {
      console.error("Erreur annulation:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Vérifier la signature d'un webhook
   */
  verifierSignatureWebhook(body, signature) {
    const crypto = require("crypto");
    const expectedSignature = crypto
      .createHmac("sha256", process.env.DROPBOX_SIGN_WEBHOOK_SECRET)
      .update(body)
      .digest("hex");

    return `sha256=${expectedSignature}` === signature;
  }

  /**
   * Traiter un événement webhook
   */
  async traiterEvenementWebhook(eventData) {
    try {
      const { event_type, event_time, event_hash } = eventData.event;
      const signatureRequest = eventData.signature_request;

      switch (event_type) {
        case "signature_request_sent":
          return await this.gererEvenementEnvoi(signatureRequest, event_time);

        case "signature_request_viewed":
          return await this.gererEvenementVue(signatureRequest, event_time);

        case "signature_request_signed":
          return await this.gererEvenementSignature(
            signatureRequest,
            event_time
          );

        case "signature_request_all_signed":
          return await this.gererEvenementToutSigne(
            signatureRequest,
            event_time
          );

        case "signature_request_declined":
          return await this.gererEvenementRefus(signatureRequest, event_time);

        case "signature_request_error":
          return await this.gererEvenementErreur(signatureRequest, event_time);

        default:
          console.log(`Événement non géré: ${event_type}`);
          return { success: true, handled: false };
      }
    } catch (error) {
      console.error("Erreur traitement webhook:", error);
      return { success: false, error: error.message };
    }
  }

  // Méthodes privées pour gérer les événements
  async gererEvenementEnvoi(signatureRequest, eventTime) {
    // Mettre à jour le statut des signatures
    console.log(`Demande envoyée: ${signatureRequest.signature_request_id}`);
    return { success: true, event: "sent" };
  }

  async gererEvenementVue(signatureRequest, eventTime) {
    console.log(`Document consulté: ${signatureRequest.signature_request_id}`);
    return { success: true, event: "viewed" };
  }

  async gererEvenementSignature(signatureRequest, eventTime) {
    console.log(`Document signé: ${signatureRequest.signature_request_id}`);
    return { success: true, event: "signed" };
  }

  async gererEvenementToutSigne(signatureRequest, eventTime) {
    console.log(
      `Tous les documents signés: ${signatureRequest.signature_request_id}`
    );
    return { success: true, event: "all_signed" };
  }

  async gererEvenementRefus(signatureRequest, eventTime) {
    console.log(`Document refusé: ${signatureRequest.signature_request_id}`);
    return { success: true, event: "declined" };
  }

  async gererEvenementErreur(signatureRequest, eventTime) {
    console.error(`Erreur signature: ${signatureRequest.signature_request_id}`);
    return { success: true, event: "error" };
  }

  /**
   * Obtenir les informations du compte
   */
  async obtenirInfosCompte() {
    try {
      const response = await this.accountApi.accountGet();

      return {
        success: true,
        data: {
          accountId: response.body.account.accountId,
          emailAddress: response.body.account.emailAddress,
          isLocked: response.body.account.isLocked,
          isPaidHs: response.body.account.isPaidHs,
          isPaidHf: response.body.account.isPaidHf,
          quotas: response.body.account.quotas,
        },
      };
    } catch (error) {
      console.error("Erreur info compte:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = new DropboxSignService();
