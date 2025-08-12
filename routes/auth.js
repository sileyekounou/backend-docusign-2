const express = require("express");
const { body } = require("express-validator");
const router = express.Router();

const authController = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");
const {
  nettoyerDonnees,
  validerLogiqueMétier,
} = require("../middleware/dataCleanup");

// Validation améliorée pour l'inscription
const validationInscription = [
  body("nom")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Le nom doit contenir entre 2 et 50 caractères")
    .matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .withMessage("Le nom ne peut contenir que des lettres, espaces, apostrophes et tirets"),

  body("prenom")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Le prénom doit contenir entre 2 et 50 caractères")
    .matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .withMessage("Le prénom ne peut contenir que des lettres, espaces, apostrophes et tirets"),

  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Email invalide")
    .isLength({ max: 255 })
    .withMessage("Email trop long"),

  body("motDePasse")
    .isLength({ min: 8, max: 128 })
    .withMessage("Le mot de passe doit contenir entre 8 et 128 caractères")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage(
      "Le mot de passe doit contenir au moins une minuscule, une majuscule, un chiffre et un caractère spécial"
    ),

  body("role")
    .isIn([
      "administrateur",
      "enseignant",
      "responsable_pedagogique",
      "etudiant",
    ])
    .withMessage("Rôle invalide"),

  body("telephone")
    .optional()
    .custom((value) => {
      if (value && value.trim() !== '') {
        const phoneRegex = /^(\+33|0)[1-9](\d{8})$/;
        if (!phoneRegex.test(value)) {
          throw new Error("Numéro de téléphone invalide");
        }
      }
      return true;
    }),

  // Validation conditionnelle pour l'établissement
  body("etablissement")
    .custom((value, { req }) => {
      if (req.body.role && req.body.role !== "etudiant") {
        if (!value || value.trim() === '') {
          throw new Error("L'établissement est obligatoire pour ce rôle");
        }
        if (value.trim().length < 2 || value.trim().length > 100) {
          throw new Error("L'établissement doit contenir entre 2 et 100 caractères");
        }
      }
      return true;
    }),

  // Validation conditionnelle pour le numéro étudiant
  body("numeroEtudiant")
    .custom((value, { req }) => {
      if (req.body.role === "etudiant") {
        if (!value || value.trim() === '') {
          throw new Error("Le numéro étudiant est obligatoire");
        }
        if (value.trim().length < 3 || value.trim().length > 20) {
          throw new Error("Le numéro étudiant doit contenir entre 3 et 20 caractères");
        }
        // Vérifier le format (ajustez selon vos besoins)
        if (!/^[A-Z0-9-]+$/i.test(value.trim())) {
          throw new Error("Format de numéro étudiant invalide");
        }
      } else {
        // Pour les non-étudiants, le champ doit être vide ou absent
        if (value && value.trim() !== '') {
          throw new Error("Les non-étudiants ne doivent pas avoir de numéro étudiant");
        }
      }
      return true;
    }),

  // Validation conditionnelle pour la promotion
  body("promotion")
    .custom((value, { req }) => {
      if (req.body.role === "etudiant") {
        if (!value || value.trim() === '') {
          throw new Error("La promotion est obligatoire pour les étudiants");
        }
      }
      return true;
    }),
];

const validationConnexion = [
  body("email").isEmail().normalizeEmail().withMessage("Email invalide"),

  body("motDePasse").notEmpty().withMessage("Mot de passe requis"),
];

const validationChangementMotDePasse = [
  body("ancienMotDePasse").notEmpty().withMessage("Ancien mot de passe requis"),

  body("nouveauMotDePasse")
    .isLength({ min: 8 })
    .withMessage("Le nouveau mot de passe doit contenir au moins 8 caractères")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage(
      "Le nouveau mot de passe doit contenir au moins une minuscule, une majuscule, un chiffre et un caractère spécial"
    ),
];

const validationMiseAJourProfil = [
  body("nom")
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Le nom doit contenir entre 2 et 50 caractères"),

  body("prenom")
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Le prénom doit contenir entre 2 et 50 caractères"),

  body("telephone")
    .optional()
    .matches(/^(\+33|0)[1-9](\d{8})$/)
    .withMessage("Numéro de téléphone invalide"),

  body("etablissement")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("L'établissement doit contenir entre 2 et 100 caractères"),
];

const validationResetMotDePasse = [
  body("email").isEmail().normalizeEmail().withMessage("Email invalide"),
];

const validationNouveauMotDePasse = [
  body("token").notEmpty().withMessage("Token requis"),

  body("nouveauMotDePasse")
    .isLength({ min: 8 })
    .withMessage("Le mot de passe doit contenir au moins 8 caractères")
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage(
      "Le mot de passe doit contenir au moins une minuscule, une majuscule, un chiffre et un caractère spécial"
    ),
];

// Routes publiques (non authentifiées)

/**
 * @route   POST /api/auth/inscription
 * @desc    Inscription d'un nouvel utilisateur
 * @access  Public (mais peut être restreint selon les besoins)
 */
router.post(
  "/inscription",
  nettoyerDonnees,           // Nettoyer les données d'entrée
  validerLogiqueMétier,      // Appliquer la logique métier selon le rôle
  validationInscription,     // Valider les données
  authMiddleware.rateLimitParUtilisateur(5, 15 * 60 * 1000), // 5 tentatives par 15 min
  authController.inscription
);

/**
 * @route   POST /api/auth/connexion
 * @desc    Connexion d'un utilisateur
 * @access  Public
 */
router.post(
  "/connexion",
  validationConnexion,
  authMiddleware.rateLimitParUtilisateur(10, 15 * 60 * 1000), // 10 tentatives par 15 min
  authController.connexion
);

/**
 * @route   POST /api/auth/mot-de-passe/demande-reset
 * @desc    Demander une réinitialisation de mot de passe
 * @access  Public
 */
router.post(
  "/mot-de-passe/demande-reset",
  validationResetMotDePasse,
  authMiddleware.rateLimitParUtilisateur(3, 60 * 60 * 1000), // 3 tentatives par heure
  authController.demanderResetMotDePasse
);

/**
 * @route   POST /api/auth/mot-de-passe/reset
 * @desc    Réinitialiser le mot de passe avec un token
 * @access  Public
 */
router.post(
  "/mot-de-passe/reset",
  validationNouveauMotDePasse,
  authController.reinitialiserMotDePasse
);

/**
 * @route   GET /api/auth/verify-email/:token
 * @desc    Vérifier l'email avec un token
 * @access  Public
 */
router.get("/verify-email/:token", authController.verifierEmail);

// Routes protégées (authentification requise)

/**
 * @route   GET /api/auth/profil
 * @desc    Obtenir le profil de l'utilisateur connecté
 * @access  Privé
 */
router.get(
  "/profil",
  authMiddleware.authentifier,
  authController.obtenirProfil
);

/**
 * @route   PUT /api/auth/profil
 * @desc    Mettre à jour le profil de l'utilisateur connecté
 * @access  Privé
 */
router.put(
  "/profil",
  authMiddleware.authentifier,
  validationMiseAJourProfil,
  authMiddleware.journaliserAction("Mise à jour profil"),
  authController.mettreAJourProfil
);

/**
 * @route   POST /api/auth/changer-mot-de-passe
 * @desc    Changer le mot de passe de l'utilisateur connecté
 * @access  Privé
 */
router.post(
  "/changer-mot-de-passe",
  authMiddleware.authentifier,
  validationChangementMotDePasse,
  authMiddleware.journaliserAction("Changement mot de passe"),
  authController.changerMotDePasse
);

/**
 * @route   POST /api/auth/deconnexion
 * @desc    Déconnexion (principalement côté client)
 * @access  Privé
 */
router.post(
  "/deconnexion",
  authMiddleware.authentifier,
  authController.deconnexion
);

/**
 * @route   POST /api/auth/refresh-token
 * @desc    Rafraîchir le token JWT
 * @access  Privé
 */
router.post("/refresh-token", authMiddleware.authentifier, (req, res) => {
  // Générer un nouveau token
  const jwt = require("jsonwebtoken");
  const nouveauToken = jwt.sign(
    { userId: req.user._id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "24h" }
  );

  res.json({
    success: true,
    message: "Token rafraîchi avec succès",
    data: {
      token: nouveauToken,
      utilisateur: req.user.toPublicJSON(),
    },
  });
});

/**
 * @route   GET /api/auth/verifier-session
 * @desc    Vérifier si la session est valide
 * @access  Privé
 */
router.get("/verifier-session", authMiddleware.authentifier, (req, res) => {
  res.json({
    success: true,
    message: "Session valide",
    data: {
      utilisateur: req.user.toPublicJSON(),
      sessionInfo: {
        dernierLogin: req.user.dernierLogin,
        emailVerifie: req.user.emailVerifie,
      },
    },
  });
});

/**
 * @route   POST /api/auth/resend-verification
 * @desc    Renvoyer l'email de vérification
 * @access  Privé
 */
router.post(
  "/resend-verification",
  authMiddleware.authentifier,
  authMiddleware.rateLimitParUtilisateur(3, 60 * 60 * 1000), // 3 par heure
  async (req, res) => {
    try {
      if (req.user.emailVerifie) {
        return res.status(400).json({
          success: false,
          message: "Email déjà vérifié",
        });
      }

      // Logique pour renvoyer l'email de vérification
      // (à implémenter selon les besoins)

      res.json({
        success: true,
        message: "Email de vérification renvoyé",
      });
    } catch (error) {
      console.error("Erreur renvoi vérification:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors du renvoi de l'email de vérification",
      });
    }
  }
);

// Middleware de gestion des erreurs spécifique aux routes d'auth
router.use(authMiddleware.gererErreursAuth);

module.exports = router;
