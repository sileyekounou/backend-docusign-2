const { validationResult } = require("express-validator");
const multer = require("multer");
const path = require("path");
const fs = require("fs").promises;
const crypto = require("crypto");
const Document = require("../models/Document");
const User = require("../models/User");
const dropboxSignService = require("../services/dropboxSignService");

// Configuration de Multer pour l'upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../uploads/documents");
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const extension = path.extname(file.originalname);
    cb(null, `doc-${uniqueSuffix}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Type de fichier non autorisé. Seuls PDF, DOC et DOCX sont acceptés."
        )
      );
    }
  },
});

// Middleware d'upload
exports.uploadMiddleware = upload.single("fichier");

/**
 * Créer un nouveau document
 */
exports.creerDocument = async (req, res) => {
  try {
    const erreurs = validationResult(req);
    if (!erreurs.isEmpty()) {
      // Supprimer le fichier uploadé en cas d'erreur
      if (req.file) {
        await fs.unlink(req.file.path).catch(console.error);
      }
      return res.status(400).json({
        success: false,
        message: "Données invalides",
        erreurs: erreurs.array(),
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Aucun fichier fourni",
      });
    }

    const {
      titre,
      description,
      type,
      categorie,
      etudiantsConcernes,
      workflowSignature,
      niveauConfidentialite,
      motsCles,
      dateLimiteSignature,
      metadonneesPedagogiques,
    } = req.body;

    // Calculer le hash du fichier
    const fileBuffer = await fs.readFile(req.file.path);
    const hash = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    // Créer le document
    const nouveauDocument = new Document({
      titre,
      description,
      type,
      categorie,
      fichier: {
        nom: req.file.filename,
        nomOriginal: req.file.originalname,
        chemin: req.file.path,
        taille: req.file.size,
        mimeType: req.file.mimetype,
        hash,
      },
      creeParUtilisateur: req.user._id,
      proprietaire: req.user._id,
      etudiantsConcernes: etudiantsConcernes
        ? JSON.parse(etudiantsConcernes)
        : [],
      workflowSignature: workflowSignature ? JSON.parse(workflowSignature) : [],
      niveauConfidentialite: niveauConfidentialite || "restreint",
      motsCles: motsCles ? JSON.parse(motsCles) : [],
      dateLimiteSignature: dateLimiteSignature
        ? new Date(dateLimiteSignature)
        : null,
      metadonneesPedagogiques: metadonneesPedagogiques
        ? JSON.parse(metadonneesPedagogiques)
        : {},
    });

    // Ajouter à l'historique
    nouveauDocument.ajouterHistorique(
      "creation",
      req.user._id,
      "Document créé"
    );

    await nouveauDocument.save();

    // Peupler les références pour la réponse
    await nouveauDocument.populate([
      { path: "creeParUtilisateur", select: "nom prenom email" },
      { path: "etudiantsConcernes", select: "nom prenom email numeroEtudiant" },
      { path: "workflowSignature.utilisateur", select: "nom prenom email" },
    ]);

    res.status(201).json({
      success: true,
      message: "Document créé avec succès",
      data: {
        document: nouveauDocument,
      },
    });
  } catch (error) {
    // Supprimer le fichier en cas d'erreur
    if (req.file) {
      await fs.unlink(req.file.path).catch(console.error);
    }

    console.error("Erreur création document:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la création du document",
    });
  }
};

/**
 * Obtenir la liste des documents
 */
exports.obtenirDocuments = async (req, res) => {
  try {
    const {
      page = 1,
      limite = 10,
      type,
      categorie,
      statut,
      recherche,
      dateDebut,
      dateFin,
      utilisateur,
    } = req.query;

    // Construire le filtre de base selon le rôle
    let filtreBase = {};

    if (req.user.role === "etudiant") {
      // Les étudiants ne voient que les documents qui les concernent
      filtreBase = {
        $or: [
          { etudiantsConcernes: req.user._id },
          { "workflowSignature.utilisateur": req.user._id },
        ],
      };
    } else if (req.user.role === "enseignant") {
      // Les enseignants voient leurs documents et ceux où ils doivent signer
      filtreBase = {
        $or: [
          { creeParUtilisateur: req.user._id },
          { "workflowSignature.utilisateur": req.user._id },
        ],
      };
    } else if (req.user.role === "responsable_pedagogique") {
      // Les responsables voient plus de documents
      filtreBase = {
        $or: [
          { creeParUtilisateur: req.user._id },
          { "workflowSignature.utilisateur": req.user._id },
          { categorie: "pedagogique" },
        ],
      };
    }
    // Les administrateurs voient tout (pas de filtre)

    // Construire les filtres additionnels
    const filtres = { ...filtreBase };

    if (type) filtres.type = type;
    if (categorie) filtres.categorie = categorie;
    if (statut) filtres.statut = statut;
    if (utilisateur && req.user.role === "administrateur") {
      filtres.creeParUtilisateur = utilisateur;
    }

    // Filtre de date
    if (dateDebut || dateFin) {
      filtres.dateCreation = {};
      if (dateDebut) filtres.dateCreation.$gte = new Date(dateDebut);
      if (dateFin) filtres.dateCreation.$lte = new Date(dateFin);
    }

    // Recherche textuelle
    if (recherche) {
      filtres.$or = [
        { titre: { $regex: recherche, $options: "i" } },
        { description: { $regex: recherche, $options: "i" } },
        { motsCles: { $in: [new RegExp(recherche, "i")] } },
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limite),
      sort: { dateCreation: -1 },
      populate: [
        { path: "creeParUtilisateur", select: "nom prenom email" },
        {
          path: "etudiantsConcernes",
          select: "nom prenom email numeroEtudiant",
        },
        { path: "workflowSignature.utilisateur", select: "nom prenom email" },
      ],
    };

    // const documents = await Document.paginate(filtres, options);
    const limit = parseInt(options.limit) || 10;
    const skip = (page - 1) * limit;

    const totalDocs = await Document.countDocuments(filtres);
    const docs = await Document.find(filtres)
      .populate(options.populate)
      .sort(options.sort)
      .skip(skip)
      .limit(limit);

    const documents = {
      docs,
      totalDocs,
      limit,
      page,
      totalPages: Math.ceil(totalDocs / limit),
      hasNextPage: page < Math.ceil(totalDocs / limit),
      hasPrevPage: page > 1
    };

    res.json({
      success: true,
      data: {
        documents: documents.docs,
        pagination: {
          page: documents.page,
          pages: documents.totalPages,
          total: documents.totalDocs,
          limite: documents.limit,
          hasNext: documents.hasNextPage,
          hasPrev: documents.hasPrevPage,
        },
      },
    });
  } catch (error) {
    console.error("Erreur obtention documents:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'obtention des documents",
    });
  }
};

/**
 * Obtenir un document par ID
 */
exports.obtenirDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await Document.findById(id)
      .populate("creeParUtilisateur", "nom prenom email")
      .populate("etudiantsConcernes", "nom prenom email numeroEtudiant")
      .populate("workflowSignature.utilisateur", "nom prenom email")
      .populate("historique.utilisateur", "nom prenom email");

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document non trouvé",
      });
    }

    // Vérifier les permissions
    if (!document.peutEtreVuPar(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Accès refusé",
      });
    }

    // Incrémenter le compteur de vues
    document.nombreVues += 1;
    await document.save();

    res.json({
      success: true,
      data: {
        document,
      },
    });
  } catch (error) {
    console.error("Erreur obtention document:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'obtention du document",
    });
  }
};

/**
 * Mettre à jour un document
 */
exports.mettreAJourDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const erreurs = validationResult(req);

    if (!erreurs.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Données invalides",
        erreurs: erreurs.array(),
      });
    }

    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document non trouvé",
      });
    }

    // Vérifier les permissions
    if (!document.peutEtreModifiePar(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Vous n'avez pas l'autorisation de modifier ce document",
      });
    }

    const champsAutorises = [
      "titre",
      "description",
      "niveauConfidentialite",
      "motsCles",
      "dateLimiteSignature",
      "metadonneesPedagogiques",
    ];

    const anciennesValeurs = {};
    const miseAJour = {};

    champsAutorises.forEach((champ) => {
      if (req.body[champ] !== undefined) {
        anciennesValeurs[champ] = document[champ];
        miseAJour[champ] = req.body[champ];
      }
    });

    // Appliquer les modifications
    Object.assign(document, miseAJour);

    // Ajouter à l'historique
    document.ajouterHistorique(
      "modification",
      req.user._id,
      "Document modifié",
      anciennesValeurs
    );

    await document.save();

    await document.populate([
      { path: "creeParUtilisateur", select: "nom prenom email" },
      { path: "etudiantsConcernes", select: "nom prenom email numeroEtudiant" },
      { path: "workflowSignature.utilisateur", select: "nom prenom email" },
    ]);

    res.json({
      success: true,
      message: "Document mis à jour avec succès",
      data: {
        document,
      },
    });
  } catch (error) {
    console.error("Erreur mise à jour document:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la mise à jour du document",
    });
  }
};

/**
 * Envoyer un document pour signature
 */

/**
 * Envoyer un document pour signature - VERSION FINALE INTÉGRÉE
 * REMPLACEZ votre fonction actuelle par celle-ci
 */
exports.envoyerPourSignature = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await Document.findById(id)
      .populate("creeParUtilisateur")
      .populate("workflowSignature.utilisateur");

    if (!document) {
      console.log("❌ Document non trouvé avec ID:", id);
      return res.status(404).json({
        success: false,
        message: "Document non trouvé",
      });
    }

    console.log("✅ Document trouvé:", document.titre);
    console.log("   Statut:", document.statut);
    console.log("   Workflow:", document.workflowSignature?.length || 0, "étapes");

    // Vérifier les permissions
    if (!document.peutEtreModifiePar(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Vous n'avez pas l'autorisation d'envoyer ce document",
      });
    }

    // Vérifier que le workflow est configuré
    if (!document.workflowSignature || document.workflowSignature.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Aucun workflow de signature configuré",
      });
    }

    for (const workflowItem of document.workflowSignature) {
      if (!workflowItem.utilisateur) {
        return res.status(400).json({
          success: false,
          message: "Utilisateur manquant dans le workflow de signature",
        });
      }
    }

    // Vérifier que le document n'est pas déjà en cours de signature
    if (document.statut !== "brouillon") {
      return res.status(400).json({
        success: false,
        message: "Le document est déjà en cours de traitement",
      });
    }

    // 🔧 CORRECTION PRINCIPALE : Créer les signatures AVANT tout
    console.log("🔧 Création des signatures locales...");
    const Signature = require("../models/Signature");
    const signaturesCreees = [];
    await document.populate("workflowSignature.utilisateur");

    // Vérifier s'il y a déjà des signatures
    const signaturesExistantes = await Signature.find({ document: document._id });
    
    if (signaturesExistantes.length === 0) {
      // Créer toutes les signatures
      for (const workflowItem of document.workflowSignature) {
        const nouvelleSignature = new Signature({
          document: document._id,
          signataire: workflowItem.utilisateur._id,
          statut: "en_attente",
          ordreSignature: workflowItem.ordre,
          creeParUtilisateur: req.user._id,
          dateExpiration: document.dateLimiteSignature || null,
        });

        nouvelleSignature.ajouterHistorique(
          "creation",
          req.user._id,
          "Signature créée lors de l'envoi pour signature"
        );

        await nouvelleSignature.save();
        signaturesCreees.push(nouvelleSignature);
      }
      console.log(`✅ ${signaturesCreees.length} signatures créées`);
    } else {
      console.log(`✅ ${signaturesExistantes.length} signatures déjà existantes`);
      signaturesCreees.push(...signaturesExistantes);
    }

    // 🔧 OPTIONNEL : Intégration Dropbox Sign (si vous l'utilisez)
    try {
      // Seulement si vous voulez utiliser Dropbox Sign
      // if (process.env.DROPBOX_SIGN_API_KEY) {
      //   const signataires = document.workflowSignature
      //     .filter((w) => w.statut === "en_attente")
      //     .sort((a, b) => a.ordre - b.ordre)
      //     .map((w) => ({
      //       email: w.utilisateur.email,
      //       nom: w.utilisateur.nom,
      //       prenom: w.utilisateur.prenom,
      //       ordre: w.ordre,
      //     }));

      //   const optionsSignature = {
      //     titre: document.titre,
      //     message: `Veuillez signer le document: ${document.titre}`,
      //     fichiers: [
      //       {
      //         chemin: document.fichier.chemin,
      //         nomOriginal: document.fichier.nomOriginal,
      //       },
      //     ],
      //     signataires,
      //     documentId: document._id.toString(),
      //   };

      //   const resultatDropbox = await dropboxSignService.creerDemandeSignature(
      //     optionsSignature
      //   );

      //   if (resultatDropbox.success) {
      //     // Mettre à jour avec les données Dropbox
      //     document.dropboxSign = {
      //       signatureRequestId: resultatDropbox.data.signatureRequestId,
      //       testMode: process.env.NODE_ENV !== "production",
      //     };

      //     // Mettre à jour les signatures avec les IDs Dropbox
      //     for (let i = 0; i < signaturesCreees.length; i++) {
      //       const signature = signaturesCreees[i];
      //       const signatureDropbox = resultatDropbox.data.signers?.find(
      //         signer => signer.email === document.workflowSignature[i].utilisateur.email
      //       );
            
      //       if (signatureDropbox) {
      //         signature.dropboxSign = {
      //           signatureId: signatureDropbox.signerId,
      //           signatureRequestId: resultatDropbox.data.signatureRequestId,
      //           signerId: signatureDropbox.signerId,
      //           statusCode: "awaiting_signature",
      //           signUrl: signatureDropbox.signUrl,
      //         };
      //         await signature.save();
      //       }
      //     }
      //   }
      // }
      // Dans envoyerPourSignature, remplace cette partie :
      if (process.env.DROPBOX_SIGN_API_KEY) {
        const signataires = document.workflowSignature
          .filter((w) => w.statut === "en_attente")
          .sort((a, b) => a.ordre - b.ordre)
          .map((w) => ({
            email: w.utilisateur.email,
            nom: w.utilisateur.nom,
            prenom: w.utilisateur.prenom,
            ordre: w.ordre,
          }));

        console.log(`👥 Signataires préparés:`, signataires);

        const optionsSignature = {
          titre: document.titre,
          message: `Veuillez signer le document: ${document.titre}`,
          fichiers: [
            {
              chemin: document.fichier.chemin,
              nomOriginal: document.fichier.nomOriginal,
            },
          ],
          signataires,
          documentId: document._id.toString(),
        };

        console.log(`🚀 Options signature:`, {
          titre: optionsSignature.titre,
          signataireCount: optionsSignature.signataires.length,
          fichierPath: optionsSignature.fichiers[0].chemin,
        });

        const resultatDropbox = await dropboxSignService.creerDemandeSignature(optionsSignature);
        
        console.log(`📋 Résultat Dropbox:`, {
          success: resultatDropbox.success,
          error: resultatDropbox.error,
          signatureRequestId: resultatDropbox.data?.signatureRequestId,
        });

        if (resultatDropbox.success) {
          // ... reste du code
        } else {
          console.error("❌ Erreur Dropbox Sign:", resultatDropbox.error);
          // Continuer même si Dropbox échoue
        }
      }

    } catch (dropboxError) {
      console.warn("⚠️ Erreur Dropbox Sign (ignorée):", dropboxError.message);
      // Continuer même si Dropbox échoue
    }

    // Mettre à jour le document
    document.statut = "en_attente_signature";
    document.ajouterHistorique(
      "signature",
      req.user._id,
      `Document envoyé pour signature à ${signaturesCreees.length} signataire(s)`
    );

    await document.save();

    // Envoyer les notifications
    try {
      const notificationService = require("../utils/notifications");
      for (const signature of signaturesCreees) {
        await signature.populate("signataire", "nom prenom email");
        await notificationService.notifierNouvelleSignature(document, signature.signataire);
      }
    } catch (notifError) {
      console.warn("⚠️ Erreur notifications:", notifError.message);
    }

    // Réponse
    await Promise.all(signaturesCreees.map(sig => 
      sig.populate("signataire", "nom prenom email")
    ));

    res.json({
      success: true,
      message: "Document envoyé pour signature avec succès",
      data: {
        document: {
          _id: document._id,
          titre: document.titre,
          statut: document.statut,
        },
        signatures: signaturesCreees.map(sig => ({
          _id: sig._id,
          signataire: {
            _id: sig.signataire._id,
            nom: sig.signataire.nom,
            prenom: sig.signataire.prenom,
            email: sig.signataire.email,
          },
          statut: sig.statut,
          ordreSignature: sig.ordreSignature,
        })),
      },
    });
    console.log("🎉 Envoi réponse au frontend");
    console.log("✅ === FIN envoyerPourSignature ===");

  } catch (error) {
    console.error("💥 ERREUR dans envoyerPourSignature:", error.message);
    console.error("Stack:", error.stack);
    console.error("Erreur envoi signature:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'envoi pour signature",
      debug: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Télécharger un document
 */
exports.telechargerDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { version = "original" } = req.query;

    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document non trouvé",
      });
    }

    // Vérifier les permissions
    if (!document.peutEtreVuPar(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Accès refusé",
      });
    }

    let cheminFichier;
    let nomFichier;

    if (
      version === "signe" &&
      document.statut === "signe" &&
      document.dropboxSign.signatureRequestId
    ) {
      // Télécharger la version signée depuis Dropbox Sign
      const cheminSigne = path.join(
        __dirname,
        "../uploads/signed",
        `${document._id}_signed.pdf`
      );

      // Vérifier si le fichier signé existe localement
      try {
        await fs.access(cheminSigne);
        cheminFichier = cheminSigne;
        nomFichier = `${
          path.parse(document.fichier.nomOriginal).name
        }_signed.pdf`;
      } catch {
        // Télécharger depuis Dropbox Sign si pas en cache
        const resultat = await dropboxSignService.telechargerDocumentSigne(
          document.dropboxSign.signatureRequestId,
          cheminSigne
        );

        if (resultat.success) {
          cheminFichier = cheminSigne;
          nomFichier = `${
            path.parse(document.fichier.nomOriginal).name
          }_signed.pdf`;
        } else {
          throw new Error("Impossible de télécharger la version signée");
        }
      }
    } else {
      // Version originale
      cheminFichier = document.fichier.chemin;
      nomFichier = document.fichier.nomOriginal;
    }

    // Vérifier que le fichier existe
    await fs.access(cheminFichier);

    // Incrémenter le compteur de téléchargements
    document.nombreTelecharements += 1;
    await document.save();

    // Envoyer le fichier
    res.download(cheminFichier, nomFichier, (err) => {
      if (err) {
        console.error("Erreur téléchargement:", err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            message: "Erreur lors du téléchargement",
          });
        }
      }
    });
  } catch (error) {
    console.error("Erreur téléchargement document:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du téléchargement du document",
    });
  }
};

/**
 * Supprimer un document
 */
exports.supprimerDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await Document.findById(id);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document non trouvé",
      });
    }

    // Seuls les administrateurs et le créateur peuvent supprimer
    if (
      req.user.role !== "administrateur" &&
      !document.creeParUtilisateur.equals(req.user._id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Vous n'avez pas l'autorisation de supprimer ce document",
      });
    }

    // Ne pas supprimer les documents signés
    if (document.statut === "signe") {
      return res.status(400).json({
        success: false,
        message: "Impossible de supprimer un document signé",
      });
    }

    // Annuler la demande de signature si en cours
    if (document.dropboxSign.signatureRequestId) {
      await dropboxSignService.annulerDemande(
        document.dropboxSign.signatureRequestId
      );
    }

    // Supprimer le fichier physique
    try {
      await fs.unlink(document.fichier.chemin);
    } catch (error) {
      console.warn("Fichier physique non trouvé:", error.message);
    }

    // Supprimer le document de la base
    await Document.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Document supprimé avec succès",
    });
  } catch (error) {
    console.error("Erreur suppression document:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la suppression du document",
    });
  }
};

/**
 * Obtenir les statistiques des documents
 */
exports.obtenirStatistiques = async (req, res) => {
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

    const stats = await Document.aggregate([
      {
        $group: {
          _id: "$statut",
          count: { $sum: 1 },
          tailleTotal: { $sum: "$fichier.taille" },
        },
      },
    ]);

    const statsParType = await Document.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ]);

    const statsParMois = await Document.aggregate([
      {
        $group: {
          _id: {
            annee: { $year: "$dateCreation" },
            mois: { $month: "$dateCreation" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.annee": -1, "_id.mois": -1 } },
      { $limit: 12 },
    ]);

    res.json({
      success: true,
      data: {
        parStatut: stats,
        parType: statsParType,
        parMois: statsParMois,
      },
    });
  } catch (error) {
    console.error("Erreur statistiques:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du calcul des statistiques",
    });
  }
};
