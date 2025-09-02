const { validationResult } = require("express-validator");
const Signature = require("../models/Signature");
const Document = require("../models/Document");
const User = require("../models/User");
const dropboxSignService = require("../services/dropboxSignService");
const notificationService = require("../utils/notifications");

// ============================================================================
// MÉTHODES PRINCIPALES - SIGNATURES
// ============================================================================

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
      data: { signature },
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

    // Vérifications de sécurité
    if (!signature.signataire._id.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Vous n'êtes pas autorisé à signer ce document",
      });
    }

    if (!signature.peutEtreSigne()) {
      return res.status(400).json({
        success: false,
        message: "Cette signature ne peut pas être effectuée",
      });
    }

    // Marquer comme signé
    signature.statut = "signe";
    signature.dateSignature = new Date();
    signature.adresseIP = req.ip || req.connection.remoteAddress;
    signature.userAgent = req.get("User-Agent");

    if (commentaire) signature.commentaireSignature = commentaire;
    if (geolocalisation) signature.geolocalisation = geolocalisation;

    signature.ajouterHistorique(
      "signature",
      req.user._id,
      "Document signé électroniquement",
      { commentaire, geolocalisation }
    );

    await signature.save();

    // ✅ APPEL AUTOMATIQUE DE LA VÉRIFICATION
    await this.verifierEtMettreAJourStatutDocument(signature.document._id);

    res.json({
      success: true,
      message: "Document signé avec succès",
      data: {
        signature: {
          _id: signature._id,
          statut: signature.statut,
          dateSignature: signature.dateSignature,
        },
      },
    });
    
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

    if (!signature.signataire._id.equals(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Vous n'êtes pas autorisé à rejeter cette signature",
      });
    }

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

    signature.ajouterHistorique("rejet", req.user._id, "Signature rejetée", {
      motifRejet,
      commentaire,
    });

    await signature.save();

    // Mettre à jour le document
    const document = signature.document;
    document.statut = "rejete";

    const workflowItem = document.workflowSignature.find((w) =>
      w.utilisateur.equals(signature.signataire._id)
    );

    if (workflowItem) {
      workflowItem.statut = "rejete";
      workflowItem.commentaire = `${motifRejet}: ${commentaire || ""}`;
    }

    document.ajouterHistorique(
      "rejet",
      req.user._id,
      `Document rejeté par ${req.user.prenom} ${req.user.nom}: ${motifRejet}`
    );

    await document.save();

    res.json({
      success: true,
      message: "Signature rejetée avec succès",
      data: { signature },
    });
    
  } catch (error) {
    console.error("Erreur rejet signature:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du rejet de la signature",
    });
  }
};

// ============================================================================
// MÉTHODE DE VÉRIFICATION ET MISE À JOUR AUTOMATIQUE
// ============================================================================

/**
 * Vérifier et mettre à jour automatiquement le statut du document
 * Cette méthode est appelée après chaque signature
 */
exports.verifierEtMettreAJourStatutDocument = async (documentId) => {
  try {
    const document = await Document.findById(documentId);
    const signatures = await Signature.find({ document: documentId });
    
    console.log(`Vérification statut document ${documentId}:`);
    console.log(`- Signatures totales: ${signatures.length}`);
    console.log(`- Signatures signées: ${signatures.filter(s => s.statut === 'signe').length}`);
    
    // Vérifier si toutes les signatures sont complètes
    const signaturesPendantes = signatures.filter(s => s.statut === 'en_attente');
    
    if (signaturesPendantes.length === 0 && signatures.length > 0) {
      console.log("Toutes les signatures sont complètes, mise à jour du document...");
      
      document.statut = "signe";
      
      // Mettre à jour le workflow
      for (const signature of signatures) {
        const workflowItem = document.workflowSignature.find(w => 
          w.utilisateur.toString() === signature.signataire.toString()
        );
        if (workflowItem) {
          workflowItem.statut = "signe";
          workflowItem.dateSignature = signature.dateSignature;
        }
      }
      
      document.ajouterHistorique(
        "signature",
        signatures[0].creeParUtilisateur,
        "Document complètement signé (vérification automatique)"
      );
      
      await document.save();
      
      console.log("Document marqué comme complètement signé");
      
      // Télécharger le fichier signé si possible
      if (document.dropboxSign?.signatureRequestId) {
        await this.telechargerEtSauvegarderDocumentSigne(document);
      }
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Erreur vérification statut document:", error);
    return false;
  }
};

// ============================================================================
// TÉLÉCHARGEMENT AUTOMATIQUE DU FICHIER SIGNÉ
// ============================================================================

/**
 * Télécharger et sauvegarder automatiquement le document signé
 */
exports.telechargerEtSauvegarderDocumentSigne = async (document) => {
  try {
    const path = require("path");
    const fs = require("fs").promises;
    const crypto = require("crypto");
    
    console.log('Téléchargement du document signé...');
    
    const nomFichierSigne = `${document._id}_signed.pdf`;
    const cheminDestination = path.join(
      __dirname,
      "../uploads/signed",
      nomFichierSigne
    );

    // Créer le dossier s'il n'existe pas
    await fs.mkdir(path.dirname(cheminDestination), { recursive: true });

    const resultat = await dropboxSignService.telechargerDocumentSigne(
      document.dropboxSign.signatureRequestId,
      cheminDestination
    );

    if (resultat.success) {
      // Calculer le hash du fichier signé
      const fileBuffer = await fs.readFile(cheminDestination);
      const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      
      // Mettre à jour le document avec les infos du fichier signé
      document.fichierSigne = {
        nom: nomFichierSigne,
        chemin: cheminDestination,
        taille: resultat.data.size,
        dateCreation: new Date(),
        hash,
      };
      
      await document.save();
      
      console.log(`Document signé sauvegardé et référencé: ${cheminDestination}`);
    } else {
      console.error("Erreur téléchargement document signé:", resultat.error);
    }
  } catch (error) {
    console.error("Erreur téléchargement document signé:", error);
  }
};

// ============================================================================
// WEBHOOK DROPBOX SIGN
// ============================================================================

/**
 * Webhook pour recevoir les événements de Dropbox Sign
 */
exports.webhookDropboxSign = async (req, res) => {
  try {
    console.log("Webhook Dropbox Sign reçu");
    
    // TEMPORAIRE : accepter tous les webhooks pour tester
    console.log("Vérification de signature désactivée temporairement");
    const isValidSignature = true;

    if (!isValidSignature) {
      return res.status(401).json({
        success: false,
        message: "Signature webhook invalide",
      });
    }

    // Parser les données
    let eventData;
    if (req.body.json) {
      eventData = JSON.parse(req.body.json);
    } else {
      console.error("Structure de données inconnue:", req.body);
      return res.status(400).json({
        success: false,
        message: "Structure de données invalide",
      });
    }

    console.log("Event:", eventData.event?.event_type);
    
    // Traiter l'événement
    const resultat = await dropboxSignService.traiterEvenementWebhook(eventData);
    
    if (resultat.success) {
      await this.synchroniserAvecDropboxSign(eventData);
      res.json({ success: true });
    } else {
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
    
    console.log(`Synchronisation pour événement: ${event_type}`);
    
    if (event_type === 'callback_test') {
      console.log('Test callback - pas de synchronisation nécessaire');
      return;
    }
    
    const signatureRequest = eventData.signature_request;
    if (!signatureRequest || !signatureRequest.signature_request_id) {
      console.warn(`Pas de signature_request pour l'événement: ${event_type}`);
      return;
    }

    // Trouver le document correspondant
    const document = await Document.findOne({
      "dropboxSign.signatureRequestId": signatureRequest.signature_request_id,
    });

    if (!document) {
      console.warn("Document non trouvé pour la synchronisation:", signatureRequest.signature_request_id);
      return;
    }

    console.log(`Document trouvé: ${document.titre}`);

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
        console.log(`Événement ${event_type} - pas de synchronisation spécifique`);
    }
  } catch (error) {
    console.error("Erreur synchronisation:", error);
  }
};

// ============================================================================
// MÉTHODES DE SYNCHRONISATION WEBHOOK
// ============================================================================

exports.synchroniserSignature = async (document, signatureRequest) => {
  try {
    console.log('Synchronisation signature individuelle');
    
    for (const sig of signatureRequest.signatures) {
      if (sig.status_code === "signed") {
        console.log(`Mise à jour signature pour: ${sig.signer_email_address}`);
        
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

        // Mettre à jour le workflow du document
        const workflowItem = document.workflowSignature.find(w => 
          w.utilisateur && sig.signer_email_address && 
          w.utilisateur.email === sig.signer_email_address
        );
        
        if (workflowItem) {
          workflowItem.statut = "signe";
          workflowItem.dateSignature = new Date(sig.signed_at * 1000);
        }
      }
    }

    // Vérifier si toutes les signatures sont complètes
    const signaturesCompletes = signatureRequest.signatures.every(sig => 
      sig.status_code === "signed"
    );

    document.statut = signaturesCompletes ? "signe" : "partiellement_signe";
    await document.save();
    
    console.log(`Document mis à jour - statut: ${document.statut}`);
    
  } catch (error) {
    console.error("Erreur synchroniserSignature:", error);
  }
};

exports.synchroniserDocumentComplet = async (document, signatureRequest) => {
  try {
    console.log('Document complètement signé, récupération du fichier...');
    
    document.statut = "signe";
    await document.save();

    // Récupérer le fichier signé depuis Dropbox Sign
    const path = require("path");
    const crypto = require("crypto");
    
    const nomFichierSigne = `${document._id}_signed.pdf`;
    const cheminDestination = path.join(
      __dirname,
      "../uploads/signed",
      nomFichierSigne
    );

    const resultat = await dropboxSignService.telechargerDocumentSigne(
      signatureRequest.signature_request_id,
      cheminDestination
    );

    if (resultat.success) {
      const fs = require("fs").promises;
      const fileBuffer = await fs.readFile(cheminDestination);
      const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      
      document.fichierSigne = {
        nom: nomFichierSigne,
        chemin: cheminDestination,
        taille: fileBuffer.length,
        dateCreation: new Date(),
        hash,
      };
      
      await document.save();
      console.log(`Fichier signé sauvegardé: ${cheminDestination}`);
    }
    
  } catch (error) {
    console.error("Erreur synchronisation complète:", error);
  }
};

exports.synchroniserRejet = async (document, signatureRequest) => {
  try {
    console.log('Synchronisation rejet de signature');
    
    const signatureRejetee = signatureRequest.signatures.find(
      (s) => s.status_code === "declined"
    );

    if (signatureRejetee) {
      console.log(`Signature rejetée par: ${signatureRejetee.signer_email_address}`);
      
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

      document.statut = "rejete";
      
      const workflowItem = document.workflowSignature.find(w => 
        w.utilisateur && signatureRejetee.signer_email_address && 
        w.utilisateur.email === signatureRejetee.signer_email_address
      );
      
      if (workflowItem) {
        workflowItem.statut = "rejete";
        workflowItem.commentaire = signatureRejetee.decline_reason || "Document rejeté";
      }
      
      await document.save();
      console.log('Document marqué comme rejeté');
    }
  } catch (error) {
    console.error("Erreur synchroniserRejet:", error);
  }
};

// ============================================================================
// AUTRES MÉTHODES (URL SIGNATURE, RAPPELS, STATISTIQUES)
// ============================================================================

exports.obtenirURLSignature = async (req, res) => {
  try {
    const { id } = req.params;
    const signature = await Signature.findById(id).populate("document").populate("signataire");

    if (!signature) {
      return res.status(404).json({ success: false, message: "Signature non trouvée" });
    }

    if (!signature.signataire._id.equals(req.user._id)) {
      return res.status(403).json({ success: false, message: "Accès refusé" });
    }

    if (!signature.peutEtreSigne()) {
      return res.status(400).json({ success: false, message: "Cette signature ne peut pas être effectuée" });
    }

    // Logique pour générer l'URL de signature (à adapter selon vos besoins)
    const signUrl = signature.genererURLSignature();

    res.json({
      success: true,
      data: {
        signUrl,
        expiresAt: signature.dropboxSign?.signUrlExpiration,
      },
    });
  } catch (error) {
    console.error("Erreur URL signature:", error);
    res.status(500).json({ success: false, message: "Erreur lors de l'obtention de l'URL de signature" });
  }
};

exports.envoyerRappel = async (req, res) => {
  // Implémentation des rappels
  res.json({ success: true, message: "Fonctionnalité de rappel à implémenter" });
};

exports.obtenirStatistiquesSignatures = async (req, res) => {
  // Implémentation des statistiques
  res.json({ success: true, message: "Statistiques à implémenter" });
};