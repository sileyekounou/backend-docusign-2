const express = require("express");
const { body, query, param } = require("express-validator");
const router = express.Router();

const documentController = require("../controllers/documentController");
const authMiddleware = require("../middleware/auth");
const roleMiddleware = require("../middleware/roleAuth");

// Validators de validation des données
const validationCreationDocument = [
  body("titre")
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage("Le titre doit contenir entre 3 et 200 caractères"),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("La description ne peut pas dépasser 1000 caractères"),

  body("type")
    .isIn([
      "note",
      "pv",
      "attestation",
      "convention",
      "releve_notes",
      "diplome",
      "autre",
    ])
    .withMessage("Type de document invalide"),

  body("categorie")
    .isIn(["pedagogique", "administratif", "stage", "evaluation"])
    .withMessage("Catégorie invalide"),

  body("niveauConfidentialite")
    .optional()
    .isIn(["public", "restreint", "confidentiel"])
    .withMessage("Niveau de confidentialité invalide"),

  body("dateLimiteSignature")
    .optional()
    .isISO8601()
    .withMessage("Date limite invalide")
    .custom((value) => {
      if (value && new Date(value) <= new Date()) {
        throw new Error("La date limite doit être future");
      }
      return true;
    }),
];

const validationMiseAJourDocument = [
  body("titre")
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage("Le titre doit contenir entre 3 et 200 caractères"),

  body("description")
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage("La description ne peut pas dépasser 1000 caractères"),

  body("niveauConfidentialite")
    .optional()
    .isIn(["public", "restreint", "confidentiel"])
    .withMessage("Niveau de confidentialité invalide"),

  body("dateLimiteSignature")
    .optional()
    .isISO8601()
    .withMessage("Date limite invalide"),
];

const validationParametresListe = [
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Le numéro de page doit être un entier positif"),

  query("limite")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("La limite doit être entre 1 et 100"),

  query("type")
    .optional()
    .isIn([
      "note",
      "pv",
      "attestation",
      "convention",
      "releve_notes",
      "diplome",
      "autre",
    ])
    .withMessage("Type de document invalide"),

  query("categorie")
    .optional()
    .isIn(["pedagogique", "administratif", "stage", "evaluation"])
    .withMessage("Catégorie invalide"),

  query("statut")
    .optional()
    .isIn([
      "brouillon",
      "en_attente_signature",
      "partiellement_signe",
      "signe",
      "rejete",
      "archive",
    ])
    .withMessage("Statut invalide"),

  query("dateDebut")
    .optional()
    .isISO8601()
    .withMessage("Date de début invalide"),

  query("dateFin").optional().isISO8601().withMessage("Date de fin invalide"),
];

const validationIdDocument = [
  param("id").isMongoId().withMessage("ID de document invalide"),
];

// Toutes les routes nécessitent une authentification
router.use(authMiddleware.authentifier);

/**
 * @route   POST /api/documents
 * @desc    Créer un nouveau document
 * @access  Privé (Enseignants et plus)
 */
router.post(
  "/",
  roleMiddleware.estEnseignantOuPlus,
  documentController.uploadMiddleware,
  validationCreationDocument,
  authMiddleware.journaliserAction("Création document"),
  documentController.creerDocument
);

/**
 * @route   GET /api/documents
 * @desc    Obtenir la liste des documents avec pagination et filtres
 * @access  Privé
 */
router.get("/", validationParametresListe, documentController.obtenirDocuments);

/**
 * @route   GET /api/documents/:id
 * @desc    Obtenir un document spécifique
 * @access  Privé
 */
router.get(
  "/:id",
  validationIdDocument,
  roleMiddleware.verifierPermissionsDocument("lire"),
  documentController.obtenirDocument
);

/**
 * @route   PUT /api/documents/:id
 * @desc    Mettre à jour un document
 * @access  Privé (Propriétaire ou Admin)
 */
router.put(
  "/:id",
  validationIdDocument,
  validationMiseAJourDocument,
  roleMiddleware.verifierPermissionsDocument("modifier"),
  authMiddleware.journaliserAction("Modification document"),
  documentController.mettreAJourDocument
);

/**
 * @route   POST /api/documents/:id/envoyer-signature
 * @desc    Envoyer un document pour signature
 * @access  Privé (Propriétaire ou Admin)
 */
router.post(
  "/:id/envoyer-signature",
  validationIdDocument,
  roleMiddleware.verifierPermissionsDocument("gerer_workflow"),
  authMiddleware.journaliserAction("Envoi pour signature"),
  documentController.envoyerPourSignature
);

/**
 * @route   GET /api/documents/:id/telecharger
 * @desc    Télécharger un document
 * @access  Privé
 */
router.get(
  "/:id/telecharger",
  validationIdDocument,
  [
    query("version")
      .optional()
      .isIn(["original", "signe"])
      .withMessage("Version invalide"),
  ],
  roleMiddleware.verifierPermissionsDocument("lire"),
  authMiddleware.journaliserAction("Téléchargement document"),
  documentController.telechargerDocument
);

/**
 * @route   DELETE /api/documents/:id
 * @desc    Supprimer un document
 * @access  Privé (Propriétaire ou Admin)
 */
router.delete(
  "/:id",
  validationIdDocument,
  roleMiddleware.verifierPermissionsDocument("supprimer"),
  authMiddleware.journaliserAction("Suppression document"),
  documentController.supprimerDocument
);

/**
 * @route   GET /api/documents/stats/global
 * @desc    Obtenir les statistiques des documents
 * @access  Privé (Responsables et Admins)
 */
router.get(
  "/stats/global",
  roleMiddleware.estResponsableOuPlus,
  documentController.obtenirStatistiques
);

/**
 * @route   GET /api/documents/mes-documents/dashboard
 * @desc    Obtenir le tableau de bord des documents de l'utilisateur
 * @access  Privé
 */
router.get("/mes-documents/dashboard", async (req, res) => {
  try {
    const Document = require("../models/Document");
    const Signature = require("../models/Signature");

    const userId = req.user._id;

    // Documents créés par l'utilisateur
    const documentsCreesStats = await Document.aggregate([
      { $match: { creeParUtilisateur: userId } },
      {
        $group: {
          _id: "$statut",
          count: { $sum: 1 },
        },
      },
    ]);

    // Signatures en attente pour l'utilisateur
    const signaturesEnAttente = await Signature.countDocuments({
      signataire: userId,
      statut: "en_attente",
    });

    // Documents récents créés
    const documentsRecents = await Document.find({
      creeParUtilisateur: userId,
    })
      .sort({ dateCreation: -1 })
      .limit(5)
      .populate("etudiantsConcernes", "nom prenom numeroEtudiant")
      .select("titre type statut dateCreation");

    // Signatures récentes
    const signaturesRecentes = await Signature.find({
      signataire: userId,
    })
      .sort({ dateCreation: -1 })
      .limit(5)
      .populate("document", "titre type")
      .select("statut dateCreation dateSignature");

    res.json({
      success: true,
      data: {
        documentsCreesStats,
        signaturesEnAttente,
        documentsRecents,
        signaturesRecentes,
      },
    });
  } catch (error) {
    console.error("Erreur dashboard:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'obtention du tableau de bord",
    });
  }
});

/**
 * @route   GET /api/documents/recherche
 * @desc    Rechercher des documents
 * @access  Privé
 */
router.get(
  "/recherche",
  [
    query("q")
      .notEmpty()
      .trim()
      .isLength({ min: 2 })
      .withMessage("Le terme de recherche doit contenir au moins 2 caractères"),

    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Le numéro de page doit être un entier positif"),

    query("limite")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("La limite doit être entre 1 et 50"),
  ],
  async (req, res) => {
    try {
      const { q: terme, page = 1, limite = 10, ...filtres } = req.query;

      const Document = require("../models/Document");

      // Construire les filtres de base selon le rôle
      let filtreBase = {};

      if (req.user.role === "etudiant") {
        filtreBase = {
          $or: [
            { etudiantsConcernes: req.user._id },
            { "workflowSignature.utilisateur": req.user._id },
          ],
        };
      } else if (req.user.role === "enseignant") {
        filtreBase = {
          $or: [
            { creeParUtilisateur: req.user._id },
            { "workflowSignature.utilisateur": req.user._id },
          ],
        };
      } else if (req.user.role === "responsable_pedagogique") {
        filtreBase = {
          $or: [
            { creeParUtilisateur: req.user._id },
            { "workflowSignature.utilisateur": req.user._id },
            { categorie: "pedagogique" },
          ],
        };
      }

      const resultats = await Document.rechercherDocuments(terme, {
        ...filtreBase,
        ...filtres,
      });

      // Pagination manuelle
      const debut = (page - 1) * limite;
      const fin = debut + parseInt(limite);
      const documentsPagines = resultats.slice(debut, fin);

      res.json({
        success: true,
        data: {
          documents: documentsPagines,
          pagination: {
            page: parseInt(page),
            limite: parseInt(limite),
            total: resultats.length,
            pages: Math.ceil(resultats.length / limite),
          },
          terme,
        },
      });
    } catch (error) {
      console.error("Erreur recherche documents:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de la recherche",
      });
    }
  }
);

/**
 * @route   POST /api/documents/:id/dupliquer
 * @desc    Dupliquer un document
 * @access  Privé (Propriétaire ou Admin)
 */
router.post(
  "/:id/dupliquer",
  validationIdDocument,
  roleMiddleware.verifierPermissionsDocument("lire"),
  async (req, res) => {
    try {
      const Document = require("../models/Document");
      const fs = require("fs").promises;
      const path = require("path");

      const documentOriginal = req.document;

      // Copier le fichier
      const extensionFichier = path.extname(documentOriginal.fichier.nom);
      const nouveauNomFichier = `doc-${Date.now()}-${Math.round(
        Math.random() * 1e9
      )}${extensionFichier}`;
      const nouveauChemin = path.join(
        path.dirname(documentOriginal.fichier.chemin),
        nouveauNomFichier
      );

      await fs.copyFile(documentOriginal.fichier.chemin, nouveauChemin);

      // Créer le document dupliqué
      const documentDuplique = new Document({
        titre: `${documentOriginal.titre} (Copie)`,
        description: documentOriginal.description,
        type: documentOriginal.type,
        categorie: documentOriginal.categorie,
        fichier: {
          nom: nouveauNomFichier,
          nomOriginal: documentOriginal.fichier.nomOriginal,
          chemin: nouveauChemin,
          taille: documentOriginal.fichier.taille,
          mimeType: documentOriginal.fichier.mimeType,
          hash: documentOriginal.fichier.hash,
        },
        creeParUtilisateur: req.user._id,
        proprietaire: req.user._id,
        niveauConfidentialite: documentOriginal.niveauConfidentialite,
        motsCles: [...documentOriginal.motsCles],
        metadonneesPedagogiques: {
          ...documentOriginal.metadonneesPedagogiques,
        },
      });

      documentDuplique.ajouterHistorique(
        "creation",
        req.user._id,
        `Document dupliqué depuis ${documentOriginal._id}`
      );

      await documentDuplique.save();

      await documentDuplique.populate([
        { path: "creeParUtilisateur", select: "nom prenom email" },
      ]);

      res.status(201).json({
        success: true,
        message: "Document dupliqué avec succès",
        data: {
          document: documentDuplique,
        },
      });
    } catch (error) {
      console.error("Erreur duplication document:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de la duplication du document",
      });
    }
  }
);

/**
 * @route   POST /api/documents/:id/archiver
 * @desc    Archiver un document
 * @access  Privé (Propriétaire ou Admin)
 */
router.post(
  "/:id/archiver",
  validationIdDocument,
  roleMiddleware.verifierPermissionsDocument("modifier"),
  async (req, res) => {
    try {
      const document = req.document;

      if (document.statut !== "signe") {
        return res.status(400).json({
          success: false,
          message: "Seuls les documents signés peuvent être archivés",
        });
      }

      document.statut = "archive";
      document.dateArchivage = new Date();

      document.ajouterHistorique("archivage", req.user._id, "Document archivé");

      await document.save();

      res.json({
        success: true,
        message: "Document archivé avec succès",
        data: {
          document,
        },
      });
    } catch (error) {
      console.error("Erreur archivage document:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de l'archivage du document",
      });
    }
  }
);

module.exports = router;
