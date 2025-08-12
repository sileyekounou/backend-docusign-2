const express = require("express");
const { body, query, param } = require("express-validator");
const router = express.Router();

const authMiddleware = require("../middleware/auth");
const roleMiddleware = require("../middleware/roleAuth");
const User = require("../models/User");

// Validators de validation des données
const validationCreationUtilisateur = [
  body("nom")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Le nom doit contenir entre 2 et 50 caractères"),

  body("prenom")
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("Le prénom doit contenir entre 2 et 50 caractères"),

  body("email").isEmail().normalizeEmail().withMessage("Email invalide"),

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
    .matches(/^(\+33|0)[1-9](\d{8})$/)
    .withMessage("Numéro de téléphone invalide"),

  body("etablissement")
    .if(body("role").not().equals("etudiant"))
    .notEmpty()
    .withMessage("L'établissement est obligatoire pour ce rôle"),

  body("numeroEtudiant")
    .if(body("role").equals("etudiant"))
    .notEmpty()
    .withMessage("Le numéro étudiant est obligatoire"),

  body("promotion")
    .if(body("role").equals("etudiant"))
    .notEmpty()
    .withMessage("La promotion est obligatoire pour les étudiants"),
];

const validationMiseAJourUtilisateur = [
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

  body("role")
    .optional()
    .isIn([
      "administrateur",
      "enseignant",
      "responsable_pedagogique",
      "etudiant",
    ])
    .withMessage("Rôle invalide"),

  body("statut")
    .optional()
    .isIn(["actif", "inactif", "suspendu"])
    .withMessage("Statut invalide"),

  body("etablissement")
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("L'établissement doit contenir entre 2 et 100 caractères"),
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

  query("role")
    .optional()
    .isIn([
      "administrateur",
      "enseignant",
      "responsable_pedagogique",
      "etudiant",
    ])
    .withMessage("Rôle invalide"),

  query("statut")
    .optional()
    .isIn(["actif", "inactif", "suspendu"])
    .withMessage("Statut invalide"),

  query("etablissement")
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage("Établissement trop court"),
];

const validationId = [
  param("id").isMongoId().withMessage("ID utilisateur invalide"),
];

// Toutes les routes nécessitent une authentification
router.use(authMiddleware.authentifier);

/**
 * @route   GET /api/users
 * @desc    Obtenir la liste des utilisateurs avec pagination et filtres
 * @access  Privé (Responsables et Admins)
 */
router.get(
  "/",
  roleMiddleware.verifierPermissionsUtilisateur("lister_utilisateurs"),
  validationParametresListe,
  async (req, res) => {
    try {
      const {
        page = 1,
        limite = 10,
        role,
        statut,
        etablissement,
        recherche,
      } = req.query;

      // Construire le filtre de base selon le rôle de l'utilisateur
      let filtreBase = {};

      if (req.user.role === "responsable_pedagogique") {
        // Les responsables ne voient que leur établissement
        filtreBase.etablissement = req.user.etablissement;
      }

      // Construire les filtres
      const filtres = { ...filtreBase };

      if (role) filtres.role = role;
      if (statut) filtres.statut = statut;
      if (etablissement && req.user.role === "administrateur") {
        filtres.etablissement = { $regex: etablissement, $options: "i" };
      }

      // Recherche textuelle
      if (recherche) {
        filtres.$or = [
          { nom: { $regex: recherche, $options: "i" } },
          { prenom: { $regex: recherche, $options: "i" } },
          { email: { $regex: recherche, $options: "i" } },
          { numeroEtudiant: { $regex: recherche, $options: "i" } },
        ];
      }

      const options = {
        page: parseInt(page),
        limit: parseInt(limite),
        sort: { dateCreation: -1 },
        select: "-motDePasse",
      };

      const utilisateurs = await User.paginate(filtres, options);

      res.json({
        success: true,
        data: {
          utilisateurs: utilisateurs.docs,
          pagination: {
            page: utilisateurs.page,
            pages: utilisateurs.totalPages,
            total: utilisateurs.totalDocs,
            limite: utilisateurs.limit,
            hasNext: utilisateurs.hasNextPage,
            hasPrev: utilisateurs.hasPrevPage,
          },
        },
      });
    } catch (error) {
      console.error("Erreur liste utilisateurs:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de l'obtention des utilisateurs",
      });
    }
  }
);

/**
 * @route   POST /api/users
 * @desc    Créer un nouvel utilisateur
 * @access  Privé (Responsables et Admins)
 */
router.post(
  "/",
  roleMiddleware.verifierPermissionsUtilisateur("creer_utilisateur"),
  validationCreationUtilisateur,
  roleMiddleware.verifierHierarchieRoles,
  async (req, res) => {
    try {
      const {
        nom,
        prenom,
        email,
        role,
        telephone,
        etablissement,
        departement,
        specialite,
        numeroEtudiant,
        promotion,
      } = req.body;

      // Vérifier que l'email n'existe pas déjà
      const utilisateurExistant = await User.findOne({
        $or: [{ email }, ...(numeroEtudiant ? [{ numeroEtudiant }] : [])],
      });

      if (utilisateurExistant) {
        return res.status(400).json({
          success: false,
          message:
            "Un utilisateur avec cet email ou numéro étudiant existe déjà",
        });
      }

      // Générer un mot de passe temporaire
      const motDePasseTemporaire =
        Math.random().toString(36).slice(-12) + "A1!";

      // Créer l'utilisateur
      const nouvelUtilisateur = new User({
        nom,
        prenom,
        email,
        motDePasse: motDePasseTemporaire,
        role,
        telephone,
        etablissement: etablissement || req.user.etablissement,
        departement,
        specialite,
        numeroEtudiant,
        promotion,
        creeParUtilisateur: req.user._id,
        statut: "actif",
      });

      await nouvelUtilisateur.save();

      // Envoyer un email avec le mot de passe temporaire
      await envoyerEmailBienvenue(nouvelUtilisateur, motDePasseTemporaire);

      res.status(201).json({
        success: true,
        message:
          "Utilisateur créé avec succès. Un email de bienvenue a été envoyé.",
        data: {
          utilisateur: nouvelUtilisateur.toPublicJSON(),
        },
      });
    } catch (error) {
      console.error("Erreur création utilisateur:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de la création de l'utilisateur",
      });
    }
  }
);

/**
 * @route   GET /api/users/:id
 * @desc    Obtenir un utilisateur spécifique
 * @access  Privé
 */
router.get(
  "/:id",
  validationId,
  roleMiddleware.verifierPermissionsUtilisateur("lire_profil"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const utilisateur = await User.findById(id).populate(
        "creeParUtilisateur",
        "nom prenom email"
      );

      if (!utilisateur) {
        return res.status(404).json({
          success: false,
          message: "Utilisateur non trouvé",
        });
      }

      res.json({
        success: true,
        data: {
          utilisateur: utilisateur.toPublicJSON(),
        },
      });
    } catch (error) {
      console.error("Erreur obtention utilisateur:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de l'obtention de l'utilisateur",
      });
    }
  }
);

/**
 * @route   PUT /api/users/:id
 * @desc    Mettre à jour un utilisateur
 * @access  Privé (Admin ou propriétaire)
 */
router.put(
  "/:id",
  validationId,
  validationMiseAJourUtilisateur,
  roleMiddleware.verifierPermissionsUtilisateur("modifier_profil"),
  roleMiddleware.verifierHierarchieRoles,
  async (req, res) => {
    try {
      const { id } = req.params;

      const champsAutorises = [
        "nom",
        "prenom",
        "telephone",
        "etablissement",
        "departement",
        "specialite",
      ];

      // Les admins peuvent modifier plus de champs
      if (req.user.role === "administrateur") {
        champsAutorises.push("role", "statut");
      }

      const miseAJour = {};
      champsAutorises.forEach((champ) => {
        if (req.body[champ] !== undefined) {
          miseAJour[champ] = req.body[champ];
        }
      });

      const utilisateur = await User.findByIdAndUpdate(id, miseAJour, {
        new: true,
        runValidators: true,
      });

      if (!utilisateur) {
        return res.status(404).json({
          success: false,
          message: "Utilisateur non trouvé",
        });
      }

      res.json({
        success: true,
        message: "Utilisateur mis à jour avec succès",
        data: {
          utilisateur: utilisateur.toPublicJSON(),
        },
      });
    } catch (error) {
      console.error("Erreur mise à jour utilisateur:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de la mise à jour de l'utilisateur",
      });
    }
  }
);

/**
 * @route   DELETE /api/users/:id
 * @desc    Supprimer un utilisateur
 * @access  Privé (Admin uniquement)
 */
router.delete(
  "/:id",
  validationId,
  roleMiddleware.verifierPermissionsUtilisateur("supprimer_utilisateur"),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Vérifier qu'on ne supprime pas soi-même
      if (id === req.user._id.toString()) {
        return res.status(400).json({
          success: false,
          message: "Vous ne pouvez pas supprimer votre propre compte",
        });
      }

      const utilisateur = await User.findById(id);

      if (!utilisateur) {
        return res.status(404).json({
          success: false,
          message: "Utilisateur non trouvé",
        });
      }

      // Vérifier s'il y a des documents ou signatures liés
      const Document = require("../models/Document");
      const Signature = require("../models/Signature");

      const documentsLies = await Document.countDocuments({
        $or: [
          { creeParUtilisateur: id },
          { etudiantsConcernes: id },
          { "workflowSignature.utilisateur": id },
        ],
      });

      const signaturesLiees = await Signature.countDocuments({
        $or: [{ signataire: id }, { creeParUtilisateur: id }],
      });

      if (documentsLies > 0 || signaturesLiees > 0) {
        // Désactiver au lieu de supprimer
        utilisateur.statut = "inactif";
        await utilisateur.save();

        return res.json({
          success: true,
          message:
            "Utilisateur désactivé (suppression impossible - données liées existantes)",
          data: {
            utilisateur: utilisateur.toPublicJSON(),
          },
        });
      }

      // Suppression complète si aucune donnée liée
      await User.findByIdAndDelete(id);

      res.json({
        success: true,
        message: "Utilisateur supprimé avec succès",
      });
    } catch (error) {
      console.error("Erreur suppression utilisateur:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de la suppression de l'utilisateur",
      });
    }
  }
);

/**
 * @route   POST /api/users/:id/reset-password
 * @desc    Réinitialiser le mot de passe d'un utilisateur
 * @access  Privé (Admin uniquement)
 */
router.post(
  "/:id/reset-password",
  validationId,
  roleMiddleware.estAdministrateur,
  async (req, res) => {
    try {
      const { id } = req.params;

      const utilisateur = await User.findById(id);

      if (!utilisateur) {
        return res.status(404).json({
          success: false,
          message: "Utilisateur non trouvé",
        });
      }

      // Générer un nouveau mot de passe temporaire
      const nouveauMotDePasse = Math.random().toString(36).slice(-12) + "A1!";

      utilisateur.motDePasse = nouveauMotDePasse;
      utilisateur.tentativesConnexion = 0;
      utilisateur.compteBloqueJusqua = undefined;

      await utilisateur.save();

      // Envoyer le nouveau mot de passe par email
      await envoyerEmailNouveauMotDePasse(utilisateur, nouveauMotDePasse);

      res.json({
        success: true,
        message:
          "Mot de passe réinitialisé avec succès. Un email a été envoyé à l'utilisateur.",
      });
    } catch (error) {
      console.error("Erreur reset mot de passe:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de la réinitialisation du mot de passe",
      });
    }
  }
);

/**
 * @route   GET /api/users/recherche/suggestions
 * @desc    Obtenir des suggestions d'utilisateurs pour l'auto-complétion
 * @access  Privé
 */
router.get(
  "/recherche/suggestions",
  [
    query("q")
      .notEmpty()
      .trim()
      .isLength({ min: 2 })
      .withMessage("Le terme de recherche doit contenir au moins 2 caractères"),

    query("role")
      .optional()
      .isIn([
        "administrateur",
        "enseignant",
        "responsable_pedagogique",
        "etudiant",
      ])
      .withMessage("Rôle invalide"),

    query("limite")
      .optional()
      .isInt({ min: 1, max: 20 })
      .withMessage("La limite doit être entre 1 et 20"),
  ],
  async (req, res) => {
    try {
      const { q: terme, role, limite = 10 } = req.query;

      const utilisateurs = await User.rechercherUtilisateurs(terme, role)
        .limit(parseInt(limite))
        .select("nom prenom email role etablissement numeroEtudiant");

      const suggestions = utilisateurs.map((user) => ({
        _id: user._id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        role: user.role,
        etablissement: user.etablissement,
        numeroEtudiant: user.numeroEtudiant,
        nomComplet: `${user.prenom} ${user.nom}`,
        libelle: `${user.prenom} ${user.nom} (${user.email})`,
      }));

      res.json({
        success: true,
        data: {
          suggestions,
          terme,
        },
      });
    } catch (error) {
      console.error("Erreur suggestions utilisateurs:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de la recherche de suggestions",
      });
    }
  }
);

/**
 * @route   GET /api/users/stats/dashboard
 * @desc    Obtenir les statistiques d'utilisateurs pour le tableau de bord
 * @access  Privé (Responsables et Admins)
 */
router.get(
  "/stats/dashboard",
  roleMiddleware.estResponsableOuPlus,
  async (req, res) => {
    try {
      // Filtrer selon le rôle
      let filtreBase = {};
      if (req.user.role === "responsable_pedagogique") {
        filtreBase.etablissement = req.user.etablissement;
      }

      // Statistiques par rôle
      const statsParRole = await User.aggregate([
        { $match: filtreBase },
        {
          $group: {
            _id: "$role",
            count: { $sum: 1 },
            actifs: {
              $sum: { $cond: [{ $eq: ["$statut", "actif"] }, 1, 0] },
            },
          },
        },
      ]);

      // Statistiques par statut
      const statsParStatut = await User.aggregate([
        { $match: filtreBase },
        {
          $group: {
            _id: "$statut",
            count: { $sum: 1 },
          },
        },
      ]);

      // Nouvelles inscriptions (30 derniers jours)
      const il30Jours = new Date();
      il30Jours.setDate(il30Jours.getDate() - 30);

      const nouvellesInscriptions = await User.countDocuments({
        ...filtreBase,
        dateCreation: { $gte: il30Jours },
      });

      // Utilisateurs par établissement (pour les admins)
      let statsParEtablissement = [];
      if (req.user.role === "administrateur") {
        statsParEtablissement = await User.aggregate([
          {
            $group: {
              _id: "$etablissement",
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]);
      }

      res.json({
        success: true,
        data: {
          statsParRole,
          statsParStatut,
          nouvellesInscriptions,
          statsParEtablissement,
        },
      });
    } catch (error) {
      console.error("Erreur stats dashboard utilisateurs:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors du calcul des statistiques",
      });
    }
  }
);

/**
 * @route   POST /api/users/import/csv
 * @desc    Importer des utilisateurs depuis un fichier CSV
 * @access  Privé (Admin uniquement)
 */
router.post(
  "/import/csv",
  roleMiddleware.estAdministrateur,
  // Middleware d'upload à implémenter
  async (req, res) => {
    try {
      // Logique d'import CSV à implémenter
      res.json({
        success: true,
        message: "Fonctionnalité d'import CSV à implémenter",
      });
    } catch (error) {
      console.error("Erreur import CSV:", error);
      res.status(500).json({
        success: false,
        message: "Erreur lors de l'import CSV",
      });
    }
  }
);

// Fonctions utilitaires
async function envoyerEmailBienvenue(utilisateur, motDePasseTemporaire) {
  const nodemailer = require("nodemailer");

  const transporteur = nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: utilisateur.email,
    subject: "Bienvenue sur la plateforme de signature électronique",
    html: `
      <h2>Bienvenue ${utilisateur.prenom} ${utilisateur.nom}</h2>
      <p>Votre compte a été créé sur notre plateforme de signature électronique.</p>
      <p><strong>Vos informations de connexion :</strong></p>
      <ul>
        <li>Email : ${utilisateur.email}</li>
        <li>Mot de passe temporaire : <strong>${motDePasseTemporaire}</strong></li>
        <li>Rôle : ${utilisateur.role}</li>
      </ul>
      <p>Veuillez vous connecter et changer votre mot de passe dès votre première connexion.</p>
      <a href="${process.env.FRONTEND_URL}/login" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
        Se connecter
      </a>
    `,
  };

  await transporteur.sendMail(mailOptions);
}

async function envoyerEmailNouveauMotDePasse(utilisateur, nouveauMotDePasse) {
  const nodemailer = require("nodemailer");

  const transporteur = nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: utilisateur.email,
    subject: "Votre nouveau mot de passe",
    html: `
      <h2>Nouveau mot de passe</h2>
      <p>Bonjour ${utilisateur.prenom} ${utilisateur.nom},</p>
      <p>Votre mot de passe a été réinitialisé par un administrateur.</p>
      <p><strong>Votre nouveau mot de passe temporaire :</strong> ${nouveauMotDePasse}</p>
      <p>Veuillez vous connecter et changer votre mot de passe immédiatement.</p>
      <a href="${process.env.FRONTEND_URL}/login" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
        Se connecter
      </a>
    `,
  };

  await transporteur.sendMail(mailOptions);
}

module.exports = router;
