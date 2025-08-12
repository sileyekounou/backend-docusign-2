const express = require("express");
const { body, query, param } = require("express-validator");
const router = express.Router();

const signatureController = require("../controllers/signatureController");
const authMiddleware = require("../middleware/auth");
const roleMiddleware = require("../middleware/roleAuth");

// Validators de validation des données
const validationSignature = [
  body("commentaire")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Le commentaire ne peut pas dépasser 500 caractères"),

  body("geolocalisation")
    .optional()
    .isObject()
    .withMessage("Géolocalisation invalide"),

  body("geolocalisation.latitude")
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage("Latitude invalide"),

  body("geolocalisation.longitude")
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage("Longitude invalide"),
];

const validationRejet = [
  body("motifRejet")
    .notEmpty()
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage("Le motif de rejet doit contenir entre 5 et 200 caractères"),

  body("commentaire")
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage("Le commentaire ne peut pas dépasser 500 caractères"),
];

const validationRappel = [
  body("message")
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage("Le message ne peut pas dépasser 300 caractères"),
];

const validationIdSignature = [
  param("id").isMongoId().withMessage("ID de signature invalide"),
];

// Toutes les routes nécessitent une authentification
router.use(authMiddleware.authentifier);

/**
 * @route   GET /api/signatures/en-attente
 * @desc    Obtenir les signatures en attente pour l'utilisateur connecté
 * @access  Privé
 */
router.get("/en-attente", signatureController.obtenirSignaturesEnAttente);

/**
 * @route   GET /api/signatures/:id
 * @desc    Obtenir une signature spécifique
 * @access  Privé
 */
router.get(
  "/:id",
  validationIdSignature,
  roleMiddleware.verifierPermissionsSignature("lire"),
  signatureController.obtenirSignature
);

/**
 * @route   POST /api/signatures/:id/signer
 * @desc    Signer un document
 * @access  Privé (Signataire uniquement)
 */
router.post(
  "/:id/signer",
  validationIdSignature,
  validationSignature,
  roleMiddleware.verifierPermissionsSignature("signer"),
  roleMiddleware.journaliserActionAvecRole("Signature document"),
  signatureController.signerDocument
);

/**
 * @route   POST /api/signatures/:id/rejeter
 * @desc    Rejeter une signature
 * @access  Privé (Signataire uniquement)
 */
router.post(
  "/:id/rejeter",
  validationIdSignature,
  validationRejet,
  roleMiddleware.verifierPermissionsSignature("rejeter"),
  roleMiddleware.journaliserActionAvecRole("Rejet signature"),
  signatureController.rejeterSignature
);

/**
 * @route   GET /api/signatures/:id/url-signature
 * @desc    Obtenir l'URL de signature intégrée
 * @access  Privé (Signataire uniquement)
 */
router.get(
  "/:id/url-signature",
  validationIdSignature,
  roleMiddleware.verifierPermissionsSignature("signer"),
  signatureController.obtenirURLSignature
);

/**
 * @route   POST /api/signatures/:id/rappel
 * @desc    Envoyer un rappel de signature
 * @access  Privé (Créateur ou Admin)
 */
router.post(
  "/:id/rappel",
  validationIdSignature,
  validationRappel,
  roleMiddleware.verifierPermissionsSignature("rappeler"),
  roleMiddleware.journaliserActionAvecRole("Envoi rappel signature"),
  signatureController.envoyerRappel
);

/**
 * @route   GET /api/signatures/stats/global
 * @desc    Obtenir les statistiques de signatures
 * @access  Privé (Responsables et Admins)
 */
router.get(
  "/stats/global",
  roleMiddleware.estResponsableOuPlus,
  signatureController.obtenirStatistiquesSignatures
);

/**
 * @route   GET /api/signatures/mes-signatures/historique
 * @desc    Obtenir l'historique des signatures de l'utilisateur
 * @access  Privé
 */
router.get(
  "/mes-signatures/historique",
  [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Le numéro de page doit être un entier positif"),

    query("limite")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("La limite doit être entre 1 et 50"),

    query("statut")
      .optional()
      .isIn(["en_attente", "signe", "rejete", "annule", "expire"])
      .withMessage("Statut invalide"),

    query("dateDebut")
      .optional()
      .isISO8601()
      .withMessage("Date de début invalide"),

    query("dateFin").optional().isISO8601().withMessage("Date de fin invalide"),
  ],
  async (req, res) => {
    try {
      const { page = 1, limite = 10, statut, dateDebut, dateFin } = req.query;

      const Signature = require("../models/Signature");

      // Construire le filtre
      const filtre = {
        signataire: req.user._id,
      };

      if (statut) {
        filtre.statut = statut;
      }

      if (dateDebut || dateFin) {
        filtre.dateCreation = {};
        if (dateDebut) filtre.dateCreation.$gte = new Date(dateDebut);
        if (dateFin) filtre.dateCreation.$lte = new Date(dateFin);
      }

      const options = {
        page: parseInt(page),
        limit: parseInt(limite),
        sort: { dateCreation: -1 },
        populate: [
          {
            path: "document",
            select: "titre type categorie dateCreation statut",
            populate: {
              path: "creeParUtilisateur",
              select: "nom prenom email",
            },
          },
          { path: "creeParUtilisateur", select: "nom prenom email" },
        ],
      };

      const signatures = await Signature.paginate(filtre, options);

      res.json({
        success: true,
        data: {
          signatures: signatures.docs,
          pagination: {
            page: signatures.page,
            pages: signatures.totalPages,
            total: signatures.totalDocs,
            limite: signatures.limit,
            hasNext: signatures.hasNextPage,
            hasPrev: signatures.hasPrevPage,
          },
        },
      });
    } catch (error) {
      console.error("Erreur historique signatures:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de l'obtention de l'historique",
      });
    }
  }
);

/**
 * @route   GET /api/signatures/dashboard/stats
 * @desc    Obtenir les statistiques de signatures pour le tableau de bord
 * @access  Privé
 */
router.get("/dashboard/stats", async (req, res) => {
  try {
    const Signature = require("../models/Signature");
    const userId = req.user._id;

    // Statistiques de base
    const statsBase = await Signature.aggregate([
      { $match: { signataire: userId } },
      {
        $group: {
          _id: "$statut",
          count: { $sum: 1 },
        },
      },
    ]);

    // Signatures par mois (6 derniers mois)
    const il6MoisPasses = new Date();
    il6MoisPasses.setMonth(il6MoisPasses.getMonth() - 6);

    const signaturesParMois = await Signature.aggregate([
      {
        $match: {
          signataire: userId,
          dateCreation: { $gte: il6MoisPasses },
        },
      },
      {
        $group: {
          _id: {
            annee: { $year: "$dateCreation" },
            mois: { $month: "$dateCreation" },
          },
          count: { $sum: 1 },
          signees: {
            $sum: { $cond: [{ $eq: ["$statut", "signe"] }, 1, 0] },
          },
        },
      },
      { $sort: { "_id.annee": 1, "_id.mois": 1 } },
    ]);

    // Délai moyen de signature
    const delaiMoyen = await Signature.aggregate([
      {
        $match: {
          signataire: userId,
          statut: "signe",
          dateSignature: { $exists: true },
        },
      },
      {
        $group: {
          _id: null,
          delaiMoyenMS: {
            $avg: {
              $subtract: ["$dateSignature", "$dateCreation"],
            },
          },
        },
      },
    ]);

    // Documents en retard
    const documentsEnRetard = await Signature.countDocuments({
      signataire: userId,
      statut: "en_attente",
      dateExpiration: { $lt: new Date() },
    });

    res.json({
      success: true,
      data: {
        statsBase,
        signaturesParMois,
        delaiMoyenJours:
          delaiMoyen.length > 0
            ? Math.round(delaiMoyen[0].delaiMoyenMS / (1000 * 60 * 60 * 24))
            : 0,
        documentsEnRetard,
      },
    });
  } catch (error) {
    console.error("Erreur stats dashboard signatures:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du calcul des statistiques",
    });
  }
});

/**
 * @route   POST /api/signatures/webhook/dropbox-sign
 * @desc    Webhook pour recevoir les événements de Dropbox Sign
 * @access  Public (avec vérification de signature)
 */
router.post(
  "/webhook/dropbox-sign",
  // Pas de middleware d'authentification pour les webhooks
  (req, res, next) => {
    // Bypass auth pour les webhooks
    next();
  },
  signatureController.webhookDropboxSign
);

/**
 * @route   POST /api/signatures/sync/dropbox-sign
 * @desc    Synchroniser manuellement avec Dropbox Sign (admin)
 * @access  Privé (Admin uniquement)
 */
router.post(
  "/sync/dropbox-sign",
  roleMiddleware.estAdministrateur,
  async (req, res) => {
    try {
      const { signatureRequestId } = req.body;

      if (!signatureRequestId) {
        return res.status(400).json({
          success: false,
          message: "ID de demande de signature requis",
        });
      }

      const dropboxSignService = require("../services/dropboxSignService");

      // Obtenir le statut depuis Dropbox Sign
      const statut = await dropboxSignService.obtenirStatutDemande(
        signatureRequestId
      );

      if (!statut.success) {
        return res.status(500).json({
          success: false,
          message: "Erreur lors de la synchronisation avec Dropbox Sign",
        });
      }

      // Synchroniser avec notre base de données
      await signatureController.synchroniserAvecDropboxSign({
        signature_request: statut.data,
        event: { event_type: "sync_manual" },
      });

      res.json({
        success: true,
        message: "Synchronisation réussie",
        data: statut.data,
      });
    } catch (error) {
      console.error("Erreur synchronisation manuelle:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de la synchronisation",
      });
    }
  }
);

/**
 * @route   GET /api/signatures/export/csv
 * @desc    Exporter les signatures au format CSV
 * @access  Privé (Responsables et Admins)
 */
router.get(
  "/export/csv",
  roleMiddleware.estResponsableOuPlus,
  [
    query("dateDebut")
      .optional()
      .isISO8601()
      .withMessage("Date de début invalide"),

    query("dateFin").optional().isISO8601().withMessage("Date de fin invalide"),

    query("statut")
      .optional()
      .isIn(["en_attente", "signe", "rejete", "annule", "expire"])
      .withMessage("Statut invalide"),
  ],
  async (req, res) => {
    try {
      const { dateDebut, dateFin, statut } = req.query;
      const Signature = require("../models/Signature");

      // Construire le filtre
      const filtre = {};

      if (req.user.role !== "administrateur") {
        // Les responsables ne voient que leurs signatures
        filtre.creeParUtilisateur = req.user._id;
      }

      if (statut) filtre.statut = statut;

      if (dateDebut || dateFin) {
        filtre.dateCreation = {};
        if (dateDebut) filtre.dateCreation.$gte = new Date(dateDebut);
        if (dateFin) filtre.dateCreation.$lte = new Date(dateFin);
      }

      const signatures = await Signature.find(filtre)
        .populate("document", "titre type categorie")
        .populate("signataire", "nom prenom email")
        .populate("creeParUtilisateur", "nom prenom email")
        .sort({ dateCreation: -1 });

      // Générer le CSV
      const lignesCSV = [
        "Document,Type,Signataire,Email,Statut,Date Création,Date Signature,Créé par",
      ];

      signatures.forEach((sig) => {
        const ligne = [
          `"${sig.document.titre}"`,
          sig.document.type,
          `"${sig.signataire.nom} ${sig.signataire.prenom}"`,
          sig.signataire.email,
          sig.statut,
          sig.dateCreation.toISOString().split("T")[0],
          sig.dateSignature
            ? sig.dateSignature.toISOString().split("T")[0]
            : "",
          `"${sig.creeParUtilisateur.nom} ${sig.creeParUtilisateur.prenom}"`,
        ].join(",");
        lignesCSV.push(ligne);
      });

      const csvContent = lignesCSV.join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="signatures_${Date.now()}.csv"`
      );
      res.send("\ufeff" + csvContent); // BOM pour Excel
    } catch (error) {
      console.error("Erreur export CSV:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de l'export CSV",
      });
    }
  }
);

module.exports = router;
