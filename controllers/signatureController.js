const { validationResult } = require("express-validator");
const Signature = require("../models/Signature");
const Document = require("../models/Document");
const User = require("../models/User");
const dropboxSignService = require("../services/dropboxSignService");
const notificationService = require("../utils/notifications");

/**
 * Obtenir les signatures en attente pour l'utilisateur connecté
 */
exports.obtenirSignaturesEnAttente = async (req, res) => {
  try {
    const signatures = await Signature.obtenirSignaturesEnAttente(req.user._id);

    res.json({
      success: true,
      data: {
        signatures,
        total: signatures.length,
      },
    });
  } catch (error) {
    console.error("Erreur signatures en attente:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'obtention des signatures en attente",
    });
  }
};

/**
 * Obtenir une signature spécifique
 */
exports.obtenirSignature = async (req, res) => {
  try {
    const { id } = req.params;

    const signature = await Signature.findById(id)
      .populate("document", "titre type categorie dateCreation fichier")
      .populate("signataire", "nom prenom email")
      .populate("creeParUtilisateur", "nom prenom email")
      .populate("historique.utilisateur", "nom prenom email");

    if (!signature) {
      return res.status(404).json({
        success: false,
        message: "Signature non trouvée",
      });
    }

    // Vérifier les permissions
    const peutVoir =
      signature.signataire._id.equals(req.user._id) ||
      signature.creeParUtilisateur._id.equals(req.user._id) ||
      req.user.role === "administrateur";

    if (!peutVoir) {
      return res.status(403).json({
        success: false,
        message: "Accès refusé",
      });
    }

    res.json({
      success: true,
      data: {
        signature,
      },
    });
  } catch (error) {
    console.error("Erreur obtention signature:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'obtention de la signature",
    });
  }
};

/**
 * Signer un document
 */
exports.signerDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { commentaire, geolocalisation } = req.body;

    const signature = await Signature.findById(id)
      .populate("document")
      .populate("signataire");

    if (!signature) {
      return res.status(404).json({
        success: false,
        message: "Signature non trouvée",
      });
    }

    // Vérifier que l'utilisateur peut signer
    if (!signature.signataire._id.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Vous n'êtes pas autorisé à signer ce document",
      });
    }

    // Vérifier que la signature peut être effectuée
    if (!signature.peutEtreSigne()) {
      return res.status(400).json({
        success: false,
        message:
          "Cette signature ne peut pas être effectuée (déjà signée, rejetée ou expirée)",
      });
    }

    try {
      // Vérifier le statut sur Dropbox Sign
      const statutDropbox = await dropboxSignService.obtenirStatutDemande(
        signature.document.dropboxSign.signatureRequestId
      );

      if (!statutDropbox.success) {
        throw new Error("Impossible de vérifier le statut sur Dropbox Sign");
      }

      // Trouver la signature correspondante dans Dropbox Sign
      const signatureDropbox = statutDropbox.data.signatures.find(
        (s) => s.signerEmailAddress === signature.signataire.email
      );

      if (!signatureDropbox) {
        throw new Error("Signature non trouvée sur Dropbox Sign");
      }

      // Si déjà signée sur Dropbox Sign, mettre à jour localement
      if (signatureDropbox.statusCode === "signed") {
        signature.statut = "signe";
        signature.dateSignature = new Date(signatureDropbox.signedAt * 1000);
        signature.dropboxSign.statusCode = "signed";
      } else {
        // Marquer comme signée localement (sera synchronisée via webhook)
        signature.statut = "signe";
        signature.dateSignature = new Date();
        signature.dropboxSign.statusCode = "signed";
      }

      // Ajouter les métadonnées
      if (commentaire) {
        signature.commentaireSignature = commentaire;
      }

      if (geolocalisation) {
        signature.geolocalisation = geolocalisation;
      }

      // Capturer les informations de session
      signature.adresseIP = req.ip || req.connection.remoteAddress;
      signature.userAgent = req.get("User-Agent");

      // Ajouter à l'historique
      signature.ajouterHistorique(
        "signature",
        req.user._id,
        "Document signé électroniquement",
        { commentaire, geolocalisation }
      );

      await signature.save();

      // Mettre à jour le document
      const document = signature.document;

      // Mettre à jour le workflow de signature du document
      const workflowItem = document.workflowSignature.find((w) =>
        w.utilisateur.equals(signature.signataire._id)
      );

      if (workflowItem) {
        workflowItem.statut = "signe";
        workflowItem.dateSignature = signature.dateSignature;
        workflowItem.commentaire = commentaire;
      }

      // Vérifier si toutes les signatures sont complètes
      if (document.estComplétementSigne()) {
        document.statut = "signe";

        // Télécharger et sauvegarder le document signé
        await this.telechargerDocumentSigne(document);

        // Notifier tous les participants
        await notificationService.notifierDocumentCompletementSigne(document);
      } else {
        document.statut = "partiellement_signe";

        // Notifier le prochain signataire
        const prochainSignataire = document.obtenirProchainSignataire();
        if (prochainSignataire) {
          await notificationService.notifierProchaineSignature(
            document,
            prochainSignataire
          );
        }
      }

      // Ajouter à l'historique du document
      document.ajouterHistorique(
        "signature",
        req.user._id,
        `Document signé par ${req.user.prenom} ${req.user.nom}`
      );

      await document.save();

      // Peupler les références pour la réponse
      await signature.populate([
        { path: "document", select: "titre type statut" },
        { path: "signataire", select: "nom prenom email" },
      ]);

      res.json({
        success: true,
        message: "Document signé avec succès",
        data: {
          signature,
          documentStatut: document.statut,
        },
      });
    } catch (dropboxError) {
      console.error("Erreur Dropbox Sign lors de la signature:", dropboxError);

      // Même en cas d'erreur Dropbox, on peut marquer comme signé localement
      // La synchronisation se fera via webhook plus tard
      signature.statut = "signe";
      signature.dateSignature = new Date();
      signature.adresseIP = req.ip;
      signature.userAgent = req.get("User-Agent");

      if (commentaire) signature.commentaireSignature = commentaire;
      if (geolocalisation) signature.geolocalisation = geolocalisation;

      signature.ajouterHistorique(
        "signature",
        req.user._id,
        "Document signé (sync en attente)"
      );
      await signature.save();

      res.json({
        success: true,
        message: "Document signé avec succès (synchronisation en cours)",
        data: { signature },
        warning: "La synchronisation avec Dropbox Sign est en cours",
      });
    }
  } catch (error) {
    console.error("Erreur signature document:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la signature du document",
    });
  }
};

/**
 * Rejeter une signature
 */
exports.rejeterSignature = async (req, res) => {
  try {
    const { id } = req.params;
    const { motifRejet, commentaire } = req.body;

    if (!motifRejet) {
      return res.status(400).json({
        success: false,
        message: "Le motif de rejet est obligatoire",
      });
    }

    const signature = await Signature.findById(id)
      .populate("document")
      .populate("signataire");

    if (!signature) {
      return res.status(404).json({
        success: false,
        message: "Signature non trouvée",
      });
    }

    // Vérifier les permissions
    if (!signature.signataire._id.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Vous n'êtes pas autorisé à rejeter cette signature",
      });
    }

    // Vérifier que la signature peut être rejetée
    if (signature.statut !== "en_attente") {
      return res.status(400).json({
        success: false,
        message: "Cette signature ne peut pas être rejetée",
      });
    }

    // Mettre à jour la signature
    signature.statut = "rejete";
    signature.motifRejet = motifRejet;
    signature.commentaireRejet = commentaire;
    signature.dateRejet = new Date();

    // Ajouter à l'historique
    signature.ajouterHistorique("rejet", req.user._id, "Signature rejetée", {
      motifRejet,
      commentaire,
    });

    await signature.save();

    // Mettre à jour le document
    const document = signature.document;
    document.statut = "rejete";

    // Mettre à jour le workflow
    const workflowItem = document.workflowSignature.find((w) =>
      w.utilisateur.equals(signature.signataire._id)
    );

    if (workflowItem) {
      workflowItem.statut = "rejete";
      workflowItem.commentaire = `${motifRejet}: ${commentaire || ""}`;
    }

    // Ajouter à l'historique du document
    document.ajouterHistorique(
      "rejet",
      req.user._id,
      `Document rejeté par ${req.user.prenom} ${req.user.nom}: ${motifRejet}`
    );

    await document.save();

    // Notifier le créateur du document
    await notificationService.notifierRejetSignature(
      document,
      signature,
      motifRejet
    );

    res.json({
      success: true,
      message: "Signature rejetée avec succès",
      data: {
        signature,
      },
    });
  } catch (error) {
    console.error("Erreur rejet signature:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du rejet de la signature",
    });
  }
};

/**
 * Obtenir l'URL de signature intégrée
 */
exports.obtenirURLSignature = async (req, res) => {
  try {
    const { id } = req.params;

    const signature = await Signature.findById(id)
      .populate("document")
      .populate("signataire");

    if (!signature) {
      return res.status(404).json({
        success: false,
        message: "Signature non trouvée",
      });
    }

    // Vérifier les permissions
    if (!signature.signataire._id.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Accès refusé",
      });
    }

    // Vérifier que la signature peut être effectuée
    if (!signature.peutEtreSigne()) {
      return res.status(400).json({
        success: false,
        message: "Cette signature ne peut pas être effectuée",
      });
    }

    // Obtenir l'URL depuis Dropbox Sign
    let signUrl = signature.genererURLSignature();

    if (!signUrl) {
      // Générer une nouvelle URL si nécessaire
      try {
        const optionsIntegree = {
          titre: signature.document.titre,
          message: `Signature requise pour: ${signature.document.titre}`,
          fichiers: [
            {
              chemin: signature.document.fichier.chemin,
              nomOriginal: signature.document.fichier.nomOriginal,
            },
          ],
          signataires: [
            {
              email: signature.signataire.email,
              nom: signature.signataire.nom,
              prenom: signature.signataire.prenom,
              ordre: signature.ordreSignature,
            },
          ],
          documentId: signature.document._id.toString(),
          urlRetour: `${process.env.FRONTEND_URL}/signatures/complete`,
        };

        const resultatIntegree =
          await dropboxSignService.creerDemandeSignatureIntegree(
            optionsIntegree
          );

        if (resultatIntegree.success) {
          const signUrlData = resultatIntegree.data.signUrls[0];

          // Mettre à jour la signature avec la nouvelle URL
          signature.dropboxSign.embeddedSignUrl = signUrlData.signUrl;
          signature.dropboxSign.signUrlExpiration = new Date(
            signUrlData.expiresAt * 1000
          );
          await signature.save();

          signUrl = signUrlData.signUrl;
        } else {
          throw new Error(resultatIntegree.error);
        }
      } catch (dropboxError) {
        console.error("Erreur génération URL signature:", dropboxError);
        return res.status(500).json({
          success: false,
          message: "Impossible de générer l'URL de signature",
        });
      }
    }

    res.json({
      success: true,
      data: {
        signUrl,
        expiresAt: signature.dropboxSign.signUrlExpiration,
      },
    });
  } catch (error) {
    console.error("Erreur URL signature:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'obtention de l'URL de signature",
    });
  }
};

/**
 * Envoyer un rappel de signature
 */
exports.envoyerRappel = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    const signature = await Signature.findById(id)
      .populate("document")
      .populate("signataire")
      .populate("creeParUtilisateur");

    if (!signature) {
      return res.status(404).json({
        success: false,
        message: "Signature non trouvée",
      });
    }

    // Seul le créateur ou un admin peut envoyer des rappels
    const peutEnvoyerRappel =
      signature.creeParUtilisateur._id.equals(req.user._id) ||
      req.user.role === "administrateur";

    if (!peutEnvoyerRappel) {
      return res.status(403).json({
        success: false,
        message:
          "Vous n'êtes pas autorisé à envoyer des rappels pour cette signature",
      });
    }

    // Vérifier que la signature est en attente
    if (signature.statut !== "en_attente") {
      return res.status(400).json({
        success: false,
        message: "Impossible d'envoyer un rappel pour cette signature",
      });
    }

    try {
      // Envoyer le rappel via Dropbox Sign
      const resultatRappel = await dropboxSignService.envoyerRappel(
        signature.document.dropboxSign.signatureRequestId,
        signature.signataire.email
      );

      if (!resultatRappel.success) {
        throw new Error(resultatRappel.error);
      }

      // Enregistrer le rappel
      signature.rappelsEnvoyes.push({
        date: new Date(),
        type: "email",
        destinataire: signature.signataire.email,
        statut: "envoye",
      });

      // Ajouter à l'historique
      signature.ajouterHistorique(
        "rappel",
        req.user._id,
        "Rappel de signature envoyé",
        { message }
      );

      await signature.save();

      // Envoyer aussi une notification locale si configuré
      await notificationService.envoyerRappelSignature(signature, message);

      res.json({
        success: true,
        message: "Rappel envoyé avec succès",
      });
    } catch (dropboxError) {
      console.error("Erreur envoi rappel Dropbox:", dropboxError);

      // Envoyer uniquement le rappel local
      await notificationService.envoyerRappelSignature(signature, message);

      signature.rappelsEnvoyes.push({
        date: new Date(),
        type: "email",
        destinataire: signature.signataire.email,
        statut: "erreur",
      });

      signature.ajouterHistorique(
        "rappel",
        req.user._id,
        "Rappel local envoyé"
      );
      await signature.save();

      res.json({
        success: true,
        message: "Rappel local envoyé (erreur Dropbox Sign)",
        warning: "Le rappel via Dropbox Sign a échoué",
      });
    }
  } catch (error) {
    console.error("Erreur envoi rappel:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'envoi du rappel",
    });
  }
};

/**
 * Obtenir les statistiques de signatures
 */
exports.obtenirStatistiquesSignatures = async (req, res) => {
  try {
    // Vérifier les permissions
    if (
      req.user.role !== "administrateur" &&
      req.user.role !== "responsable_pedagogique"
    ) {
      return res.status(403).json({
        success: false,
        message: "Accès refusé",
      });
    }

    const stats = await Signature.obtenirStatistiquesSignature();

    // Statistiques par utilisateur (top signataires)
    const statsUtilisateur = await Signature.aggregate([
      { $match: { statut: "signe" } },
      {
        $group: {
          _id: "$signataire",
          nombreSignatures: { $sum: 1 },
          delaiMoyenSignature: {
            $avg: {
              $subtract: ["$dateSignature", "$dateCreation"],
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "utilisateur",
        },
      },
      { $unwind: "$utilisateur" },
      {
        $project: {
          nombreSignatures: 1,
          delaiMoyenSignature: 1,
          nom: "$utilisateur.nom",
          prenom: "$utilisateur.prenom",
          email: "$utilisateur.email",
        },
      },
      { $sort: { nombreSignatures: -1 } },
      { $limit: 10 },
    ]);

    // Statistiques par mois
    const statsParMois = await Signature.aggregate([
      { $match: { statut: "signe" } },
      {
        $group: {
          _id: {
            annee: { $year: "$dateSignature" },
            mois: { $month: "$dateSignature" },
          },
          nombreSignatures: { $sum: 1 },
          delaiMoyenSignature: {
            $avg: {
              $subtract: ["$dateSignature", "$dateCreation"],
            },
          },
        },
      },
      { $sort: { "_id.annee": -1, "_id.mois": -1 } },
      { $limit: 12 },
    ]);

    res.json({
      success: true,
      data: {
        global: stats,
        parUtilisateur: statsUtilisateur,
        parMois: statsParMois,
      },
    });
  } catch (error) {
    console.error("Erreur statistiques signatures:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du calcul des statistiques",
    });
  }
};

/**
 * Webhook pour recevoir les événements de Dropbox Sign
 */
exports.webhookDropboxSign = async (req, res) => {
  try {
    const signature = req.get("X-HelloSign-Signature");
    const body = JSON.stringify(req.body);

    // Vérifier la signature du webhook
    if (!dropboxSignService.verifierSignatureWebhook(body, signature)) {
      console.error("Signature webhook invalide");
      return res.status(401).json({
        success: false,
        message: "Signature webhook invalide",
      });
    }

    // Traiter l'événement
    const resultat = await dropboxSignService.traiterEvenementWebhook(req.body);

    if (resultat.success) {
      // Synchroniser avec notre base de données
      await this.synchroniserAvecDropboxSign(req.body);

      res.json({ success: true });
    } else {
      console.error("Erreur traitement webhook:", resultat.error);
      res.status(500).json({
        success: false,
        message: "Erreur traitement webhook",
      });
    }
  } catch (error) {
    console.error("Erreur webhook:", error);
    res.status(500).json({
      success: false,
      message: "Erreur webhook",
    });
  }
};

/**
 * Synchroniser les données avec Dropbox Sign
 */
exports.synchroniserAvecDropboxSign = async (eventData) => {
  try {
    const { event_type } = eventData.event;
    const signatureRequest = eventData.signature_request;

    // Trouver le document correspondant
    const document = await Document.findOne({
      "dropboxSign.signatureRequestId": signatureRequest.signature_request_id,
    });

    if (!document) {
      console.warn(
        "Document non trouvé pour la synchronisation:",
        signatureRequest.signature_request_id
      );
      return;
    }

    // Traiter selon le type d'événement
    switch (event_type) {
      case "signature_request_signed":
        await this.synchroniserSignature(document, signatureRequest);
        break;

      case "signature_request_all_signed":
        await this.synchroniserDocumentComplet(document, signatureRequest);
        break;

      case "signature_request_declined":
        await this.synchroniserRejet(document, signatureRequest);
        break;

      default:
        console.log(`Événement non traité: ${event_type}`);
    }
  } catch (error) {
    console.error("Erreur synchronisation:", error);
  }
};

// Méthodes privées de synchronisation
exports.synchroniserSignature = async (document, signatureRequest) => {
  // Mettre à jour les signatures individuelles
  for (const sig of signatureRequest.signatures) {
    if (sig.status_code === "signed") {
      await Signature.updateOne(
        {
          document: document._id,
          "dropboxSign.signerId": sig.signature_id,
        },
        {
          $set: {
            statut: "signe",
            dateSignature: new Date(sig.signed_at * 1000),
            "dropboxSign.statusCode": "signed",
          },
        }
      );
    }
  }
};

exports.synchroniserDocumentComplet = async (document, signatureRequest) => {
  // Marquer le document comme complètement signé
  document.statut = "signe";
  await document.save();

  // Télécharger le document signé
  await this.telechargerDocumentSigne(document);
};

exports.synchroniserRejet = async (document, signatureRequest) => {
  // Trouver la signature rejetée
  const signatureRejetee = signatureRequest.signatures.find(
    (s) => s.status_code === "declined"
  );

  if (signatureRejetee) {
    await Signature.updateOne(
      {
        document: document._id,
        "dropboxSign.signerId": signatureRejetee.signature_id,
      },
      {
        $set: {
          statut: "rejete",
          dateRejet: new Date(),
          motifRejet: signatureRejetee.decline_reason || "Non spécifié",
        },
      }
    );

    // Marquer le document comme rejeté
    document.statut = "rejete";
    await document.save();
  }
};

exports.telechargerDocumentSigne = async (document) => {
  try {
    const cheminDestination = path.join(
      __dirname,
      "../uploads/signed",
      `${document._id}_signed.pdf`
    );

    const resultat = await dropboxSignService.telechargerDocumentSigne(
      document.dropboxSign.signatureRequestId,
      cheminDestination
    );

    if (resultat.success) {
      console.log(`Document signé sauvegardé: ${cheminDestination}`);
    } else {
      console.error("Erreur téléchargement document signé:", resultat.error);
    }
  } catch (error) {
    console.error("Erreur téléchargement document signé:", error);
  }
};
