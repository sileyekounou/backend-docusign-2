const DropboxSign = require("@dropbox/sign");
const fs = require("fs").promises;
const path = require("path");
const fsStream = require("fs"); // Pour createReadStream
const { Readable } = require("stream");

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
    const { titre, message, fichiers, signataires, documentId, options: customOptions = {} } = options;

    console.log(`🚀 Création demande signature: ${titre}`);

    // 🔧 CORRECTION : Format correct pour les signataires
    const signersData = signataires.map((signataire, index) => {
      const signerData = {
        email_address: signataire.email.trim(),  // ← email_address, pas emailAddress
        name: `${signataire.prenom.trim()} ${signataire.nom.trim()}`,
        order: signataire.ordre || index + 1,
      };
      
      console.log(`👤 Signataire ${index + 1}:`, signerData);
      return signerData;
    });

    // Préparer les fichiers avec Buffer
    const fs = require("fs");
    const filesData = [];
    
    for (const fichier of fichiers) {
      console.log(`📁 Lecture fichier: ${fichier.chemin}`);
      
      if (!fs.existsSync(fichier.chemin)) {
        throw new Error(`Fichier non trouvé: ${fichier.chemin}`);
      }

      const fileBuffer = fs.readFileSync(fichier.chemin);
      
      // Créer un objet avec les bonnes propriétés pour FormData
      const fileObj = {
        value: fileBuffer,
        options: {
          filename: fichier.nomOriginal,
          contentType: 'application/pdf'
        }
      };
      
      filesData.push(fileObj);
      console.log(`✅ Fichier préparé: ${fichier.nomOriginal} (${fileBuffer.length} bytes)`);
    }

    // 🎯 UTILISER L'OBJET DE CONFIGURATION DIRECT (pas init())
    const requestData = {
      title: titre,
      subject: titre,
      message: message || `Veuillez signer le document: ${titre}`,
      signers: signersData,  // Format simple, pas SubSigningOptions
      files: filesData,
      test_mode: 1,  // ← test_mode avec 1, pas testMode: true
    };

    // Ajouter le webhook si défini
    if (process.env.WEBHOOK_URL) {
      requestData.webhook_url = process.env.WEBHOOK_URL;  // ← webhook_url
      console.log(`🔗 Webhook: ${requestData.webhook_url}`);
    }

    // Ajouter client_id si défini
    if (process.env.DROPBOX_SIGN_CLIENT_ID) {
      requestData.client_id = process.env.DROPBOX_SIGN_CLIENT_ID;  // ← client_id
    }

    console.log(`📦 Configuration finale:`, {
      title: requestData.title,
      signersCount: requestData.signers.length,
      filesCount: requestData.files.length,
      test_mode: requestData.test_mode,
      webhook_url: !!requestData.webhook_url,
    });

    // 🔧 CRÉATION DIRECTE sans init()
    const signatureRequest = new DropboxSign.SignatureRequestSendRequest();
    
    // Assigner les propriétés une par une
    signatureRequest.title = requestData.title;
    signatureRequest.subject = requestData.subject;
    signatureRequest.message = requestData.message;
    signatureRequest.signers = requestData.signers;
    signatureRequest.files = requestData.files;
    signatureRequest.testMode = true;  // Booléen pour testMode
    
    if (requestData.webhook_url) {
      signatureRequest.webhookUrl = requestData.webhook_url;
    }
    
    if (requestData.client_id) {
      signatureRequest.clientId = requestData.client_id;
    }

    console.log("📤 Envoi à Dropbox Sign...");
    const response = await this.client.signatureRequestSend(signatureRequest);

    console.log("✅ Demande créée avec succès !");
    console.log(`📄 ID: ${response.body.signatureRequest.signatureRequestId}`);
    
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
        })),
      },
    };

  } catch (error) {
    console.error("❌ Erreur création demande signature:", error);
    console.error("❌ Détails erreur:", error.body?.error || error.message);
    
    return {
      success: false,
      error: error.message,
      details: error.body?.error?.errorMsg || null,
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
    console.log(`📥 Téléchargement document signé: ${signatureRequestId}`);
    
    const response = await this.client.signatureRequestFiles(
      signatureRequestId,
      "pdf"
    );

    // Créer le dossier de destination s'il n'existe pas
    const fs = require("fs").promises;
    const path = require("path");
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });

    // Sauvegarder le fichier
    await fs.writeFile(destinationPath, response.body);

    console.log(`✅ Document signé sauvegardé: ${destinationPath}`);
    
    return {
      success: true,
      data: {
        filePath: destinationPath,
        size: response.body.length,
      },
    };
  } catch (error) {
    console.error("❌ Erreur téléchargement document:", error);
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

  
  // Dans dropboxSignService.js, dans traiterEvenementWebhook
  async traiterEvenementWebhook(eventData) {
    try {
      const { event_type, event_time } = eventData.event;
      
      console.log(`🎯 Traitement événement: ${event_type}`);
      
      switch (event_type) {
        case "callback_test":
          console.log("✅ Test webhook réussi !");
          return { success: true, event: "callback_test" };

        case "signature_request_sent": {
          const signatureRequest = eventData.signature_request;
          return await this.gererEvenementEnvoi(signatureRequest, event_time);
        }
        case "signature_request_viewed":
          return await this.gererEvenementVue(eventData.signature_request, event_time);

        case "signature_request_signed":
          return await this.gererEvenementSignature(eventData.signature_request, event_time);

        case "signature_request_all_signed":
          return await this.gererEvenementToutSigne(eventData.signature_request, event_time);

        case "signature_request_declined":
          return await this.gererEvenementRefus(eventData.signature_request, event_time);

        case "signature_request_error":
          return await this.gererEvenementErreur(eventData.signature_request, event_time);

        default:
          console.log(`⚠️ Événement non géré: ${event_type}`);
          return { success: true, handled: false };
      }
    } catch (error) {
      console.error("❌ Erreur traitement webhook:", error);
      return { success: false, error: error.message };
    }
  }

  // verifierSignatureWebhook(req) {
  //   try {
  //     const crypto = require("crypto");
      
  //     // Récupérer les signatures des headers
  //     const receivedSha256 = req.get("content-sha256");
  //     const receivedMd5 = req.get("content-md5");
      
  //     // Récupérer le body JSON brut
  //     const eventJson = req.body.json;
  //     if (!eventJson) {
  //       console.error("❌ Données JSON manquantes");
  //       return false;
  //     }

  //     console.log(`📦 Body JSON: ${eventJson}`);

  //     // Vérification avec SHA256 (priorité)
  //     if (receivedSha256) {
  //       const expectedSha256 = crypto
  //         .createHash("sha256")
  //         .update(eventJson)
  //         .digest("hex");

  //       // Décoder le base64 reçu
  //       const decodedReceivedSha256 = Buffer.from(receivedSha256, 'base64').toString('hex');
        
  //       console.log(`🔐 SHA256 reçu (base64): ${receivedSha256}`);
  //       console.log(`🔐 SHA256 reçu (hex): ${decodedReceivedSha256}`);
  //       console.log(`🔐 SHA256 calculé: ${expectedSha256}`);
        
  //       if (decodedReceivedSha256 === expectedSha256) {
  //         console.log("✅ Vérification SHA256 réussie");
  //         return true;
  //       }
  //     }

  //     // Vérification avec MD5 (fallback)
  //     if (receivedMd5) {
  //       const expectedMd5 = crypto
  //         .createHash("md5")
  //         .update(eventJson)
  //         .digest("hex");

  //       // Décoder le base64 reçu
  //       const decodedReceivedMd5 = Buffer.from(receivedMd5, 'base64').toString('hex');
        
  //       console.log(`🔐 MD5 reçu (base64): ${receivedMd5}`);
  //       console.log(`🔐 MD5 reçu (hex): ${decodedReceivedMd5}`);
  //       console.log(`🔐 MD5 calculé: ${expectedMd5}`);
        
  //       if (decodedReceivedMd5 === expectedMd5) {
  //         console.log("✅ Vérification MD5 réussie");
  //         return true;
  //       }
  //     }

  //     console.error("❌ Aucune vérification n'a réussi");
  //     return false;
      
  //   } catch (error) {
  //     console.error("❌ Erreur vérification signature:", error);
  //     return false;
  //   }
  // }
 
 

  // Méthodes privées pour gérer les événements
  
  verifierSignatureWebhook(req) {
  try {
    const crypto = require("crypto");
    
    const eventJson = req.body.json;
    if (!eventJson) {
      console.error("❌ Données JSON manquantes");
      return false;
    }

    const eventData = JSON.parse(eventJson);
    const event = eventData.event;
    
    if (!event || !event.event_time || !event.event_hash) {
      console.error("❌ Structure d'événement invalide");
      return false;
    }

    // Méthode alternative avec API key
    const apiKey = process.env.DROPBOX_SIGN_API_KEY;
    if (!apiKey) {
      console.error("❌ DROPBOX_SIGN_API_KEY manquant");
      return false;
    }

    // Essayer différentes combinaisons
    const combinations = [
      event.event_time + apiKey,
      apiKey + event.event_time,
      eventJson + apiKey,
      apiKey + eventJson
    ];

    for (const combo of combinations) {
      const hash = crypto.createHash("sha256").update(combo).digest("hex");
      console.log(`🔐 Test combo hash: ${hash} (attendu: ${event.event_hash})`);
      
      if (hash === event.event_hash) {
        console.log("✅ Vérification réussie avec combo");
        return true;
      }
    }

    console.error("❌ Aucune combinaison n'a fonctionné");
    return false;
    
  } catch (error) {
    console.error("❌ Erreur vérification signature:", error);
    return false;
  }
}
  
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
