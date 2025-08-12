const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");
const User = require("../models/User");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

// Configuration de l'email
const transporteur = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Générer un token JWT
const genererToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "24h",
  });
};

// Générer un token de réinitialisation
const genererTokenReset = () => {
  return crypto.randomBytes(32).toString("hex");
};

/**
 * Inscription d'un nouvel utilisateur
 */
// exports.inscription = async (req, res) => {
//   try {
//     // Vérifier les erreurs de validation
//     const erreurs = validationResult(req);
//     if (!erreurs.isEmpty()) {
//       return res.status(400).json({
//         success: false,
//         message: "Données invalides",
//         erreurs: erreurs.array(),
//       });
//     }

//     const {
//       nom,
//       prenom,
//       email,
//       motDePasse,
//       role,
//       telephone,
//       etablissement,
//       departement,
//       specialite,
//       numeroEtudiant,
//       promotion,
//     } = req.body;

//     // Vérifier si l'utilisateur existe déjà
//     const filtreRecherche = { email };

//     // Ajouter numeroEtudiant au filtre seulement s'il n'est pas null/vide
//     if (numeroEtudiant && numeroEtudiant.trim() !== "") {
//       filtreRecherche.numeroEtudiant = numeroEtudiant.trim();
//     }

//     const utilisateurExistant = await User.findOne({
//       $or: [
//         { email },
//         ...(numeroEtudiant && numeroEtudiant.trim()
//           ? [{ numeroEtudiant: numeroEtudiant.trim() }]
//           : []),
//       ],
//     });

//     if (utilisateurExistant) {
//       const champConflict =
//         utilisateurExistant.email === email ? "email" : "numéro étudiant";
//       return res.status(400).json({
//         success: false,
//         message: `Un utilisateur avec cet ${champConflict} existe déjà`,
//         code: "DUPLICATE_USER",
//       });
//     }

//     // Créer le nouvel utilisateur
//     const nouvelUtilisateur = new User({
//       nom,
//       prenom,
//       email,
//       motDePasse,
//       role,
//       telephone,
//       etablissement,
//       departement,
//       specialite,
//       numeroEtudiant,
//       promotion,
//       creeParUtilisateur: req.user ? req.user._id : null,
//     });

//     await nouvelUtilisateur.save();

//     // Envoyer un email de vérification
//     await envoyerEmailVerification(nouvelUtilisateur);

//     // Générer le token
//     const token = genererToken(nouvelUtilisateur._id);

//     res.status(201).json({
//       success: true,
//       message:
//         "Utilisateur créé avec succès. Un email de vérification a été envoyé.",
//       data: {
//         token,
//         utilisateur: nouvelUtilisateur.toPublicJSON(),
//       },
//     });
//   } catch (error) {
//     console.error("Erreur inscription:", error);
//     res.status(500).json({
//       success: false,
//       message: "Erreur lors de l'inscription",
//       error: process.env.NODE_ENV === "development" ? error.message : undefined,
//     });
//   }
// };

// Amélioration de la fonction inscription dans authController.js

exports.inscription = async (req, res) => {
  try {
    // Vérifier les erreurs de validation
    const erreurs = validationResult(req);
    if (!erreurs.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Données invalides",
        erreurs: erreurs.array(),
      });
    }

    const {
      nom,
      prenom,
      email,
      motDePasse,
      role,
      telephone,
      etablissement,
      departement,
      specialite,
      numeroEtudiant,
      promotion,
    } = req.body;

    // Vérifier si l'utilisateur existe déjà
    const filtreRecherche = { email };
    
    // Ajouter numeroEtudiant au filtre seulement s'il n'est pas null/vide
    if (numeroEtudiant && numeroEtudiant.trim() !== '') {
      filtreRecherche.numeroEtudiant = numeroEtudiant.trim();
    }

    const utilisateurExistant = await User.findOne({
      $or: [
        { email },
        ...(numeroEtudiant && numeroEtudiant.trim() ? [{ numeroEtudiant: numeroEtudiant.trim() }] : [])
      ],
    });

    if (utilisateurExistant) {
      const champConflict = utilisateurExistant.email === email ? 'email' : 'numéro étudiant';
      return res.status(400).json({
        success: false,
        message: `Un utilisateur avec cet ${champConflict} existe déjà`,
        code: "DUPLICATE_USER"
      });
    }

    // Construire l'objet utilisateur en fonction du rôle
    const donneesUtilisateur = {
      nom: nom.trim(),
      prenom: prenom.trim(),
      email: email.toLowerCase().trim(),
      motDePasse,
      role,
      telephone: telephone || null,
      creeParUtilisateur: req.user ? req.user._id : null,
    };

    // Ajouter les champs spécifiques selon le rôle
    if (role === 'etudiant') {
      donneesUtilisateur.numeroEtudiant = numeroEtudiant?.trim() || null;
      donneesUtilisateur.promotion = promotion?.trim() || null;
      donneesUtilisateur.etablissement = etablissement?.trim() || null;
      donneesUtilisateur.departement = departement?.trim() || null;
      donneesUtilisateur.specialite = specialite?.trim() || null;
    } else {
      // Pour les non-étudiants
      donneesUtilisateur.etablissement = etablissement?.trim() || null;
      donneesUtilisateur.departement = departement?.trim() || null;
      donneesUtilisateur.specialite = specialite?.trim() || null;
      // Forcer à null pour éviter les conflits
      donneesUtilisateur.numeroEtudiant = null;
      donneesUtilisateur.promotion = null;
    }

    // Créer le nouvel utilisateur
    const nouvelUtilisateur = new User(donneesUtilisateur);
    await nouvelUtilisateur.save();

    // Envoyer un email de vérification
    try {
      await envoyerEmailVerification(nouvelUtilisateur);
    } catch (emailError) {
      console.error("Erreur envoi email:", emailError);
      // Ne pas faire échouer l'inscription pour un problème d'email
    }

    // Générer le token
    const token = genererToken(nouvelUtilisateur._id);

    res.status(201).json({
      success: true,
      message: "Utilisateur créé avec succès. Un email de vérification a été envoyé.",
      data: {
        token,
        utilisateur: nouvelUtilisateur.toPublicJSON(),
      },
    });

  } catch (error) {
    console.error("Erreur inscription:", error);
    
    // Gestion spécifique des erreurs MongoDB
    if (error.code === 11000) {
      const champDuplique = Object.keys(error.keyValue)[0];
      const valeurDuplique = error.keyValue[champDuplique];
      
      let message = "Données déjà existantes";
      
      if (champDuplique === 'email') {
        message = "Un utilisateur avec cet email existe déjà";
      } else if (champDuplique === 'numeroEtudiant') {
        message = valeurDuplique === '' 
          ? "Erreur de données : numéro étudiant invalide"
          : "Un étudiant avec ce numéro existe déjà";
      }
      
      return res.status(400).json({
        success: false,
        message,
        code: "DUPLICATE_KEY",
        field: champDuplique
      });
    }
    
    // Gestion des erreurs de validation Mongoose
    if (error.name === 'ValidationError') {
      const erreurs = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));
      
      return res.status(400).json({
        success: false,
        message: "Données de validation invalides",
        erreurs
      });
    }
    
    // Erreur générique
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'inscription",
      ...(process.env.NODE_ENV === "development" && { 
        error: error.message,
        stack: error.stack 
      }),
    });
  }
};
/**
 * Connexion d'un utilisateur
 */
exports.connexion = async (req, res) => {
  try {
    const erreurs = validationResult(req);
    if (!erreurs.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Données invalides",
        erreurs: erreurs.array(),
      });
    }

    const { email, motDePasse } = req.body;

    // Trouver l'utilisateur avec le mot de passe
    const utilisateur = await User.findOne({ email }).select("+motDePasse");

    if (!utilisateur) {
      return res.status(401).json({
        success: false,
        message: "Email ou mot de passe incorrect",
      });
    }

    // Vérifier si le compte est bloqué
    if (
      utilisateur.compteBloqueJusqua &&
      utilisateur.compteBloqueJusqua > new Date()
    ) {
      return res.status(423).json({
        success: false,
        message: "Compte temporairement bloqué. Veuillez réessayer plus tard.",
        bloqueJusqua: utilisateur.compteBloqueJusqua,
      });
    }

    // Vérifier le mot de passe
    const motDePasseValide = await utilisateur.verifierMotDePasse(motDePasse);

    if (!motDePasseValide) {
      // Incrémenter les tentatives de connexion
      utilisateur.tentativesConnexion += 1;

      // Bloquer le compte après 5 tentatives
      if (utilisateur.tentativesConnexion >= 5) {
        utilisateur.compteBloqueJusqua = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        utilisateur.tentativesConnexion = 0;
      }

      await utilisateur.save();

      return res.status(401).json({
        success: false,
        message: "Email ou mot de passe incorrect",
        tentativesRestantes: Math.max(0, 5 - utilisateur.tentativesConnexion),
      });
    }

    // Vérifier le statut du compte
    if (utilisateur.statut !== "actif") {
      return res.status(403).json({
        success: false,
        message: "Compte inactif ou suspendu. Contactez l'administrateur.",
      });
    }

    // Réinitialiser les tentatives de connexion
    utilisateur.tentativesConnexion = 0;
    utilisateur.compteBloqueJusqua = undefined;
    utilisateur.dernierLogin = new Date();
    await utilisateur.save();

    // Générer le token
    const token = genererToken(utilisateur._id);

    res.json({
      success: true,
      message: "Connexion réussie",
      data: {
        token,
        utilisateur: utilisateur.toPublicJSON(),
      },
    });
  } catch (error) {
    console.error("Erreur connexion:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la connexion",
    });
  }
};

/**
 * Obtenir le profil de l'utilisateur connecté
 */
exports.obtenirProfil = async (req, res) => {
  try {
    const utilisateur = await User.findById(req.user._id);

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
    console.error("Erreur obtention profil:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'obtention du profil",
    });
  }
};

/**
 * Mettre à jour le profil
 */
exports.mettreAJourProfil = async (req, res) => {
  try {
    const erreurs = validationResult(req);
    if (!erreurs.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Données invalides",
        erreurs: erreurs.array(),
      });
    }

    const champsAutorises = [
      "nom",
      "prenom",
      "telephone",
      "etablissement",
      "departement",
      "specialite",
    ];

    const miseAJour = {};
    champsAutorises.forEach((champ) => {
      if (req.body[champ] !== undefined) {
        miseAJour[champ] = req.body[champ];
      }
    });

    const utilisateur = await User.findByIdAndUpdate(req.user._id, miseAJour, {
      new: true,
      runValidators: true,
    });

    res.json({
      success: true,
      message: "Profil mis à jour avec succès",
      data: {
        utilisateur: utilisateur.toPublicJSON(),
      },
    });
  } catch (error) {
    console.error("Erreur mise à jour profil:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la mise à jour du profil",
    });
  }
};

/**
 * Changer le mot de passe
 */
exports.changerMotDePasse = async (req, res) => {
  try {
    const erreurs = validationResult(req);
    if (!erreurs.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: "Données invalides",
        erreurs: erreurs.array(),
      });
    }

    const { ancienMotDePasse, nouveauMotDePasse } = req.body;

    const utilisateur = await User.findById(req.user._id).select("+motDePasse");

    // Vérifier l'ancien mot de passe
    const ancienMotDePasseValide = await utilisateur.verifierMotDePasse(
      ancienMotDePasse
    );

    if (!ancienMotDePasseValide) {
      return res.status(400).json({
        success: false,
        message: "Ancien mot de passe incorrect",
      });
    }

    // Mettre à jour le mot de passe
    utilisateur.motDePasse = nouveauMotDePasse;
    await utilisateur.save();

    res.json({
      success: true,
      message: "Mot de passe changé avec succès",
    });
  } catch (error) {
    console.error("Erreur changement mot de passe:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du changement de mot de passe",
    });
  }
};

/**
 * Demander une réinitialisation de mot de passe
 */
exports.demanderResetMotDePasse = async (req, res) => {
  try {
    const { email } = req.body;

    const utilisateur = await User.findOne({ email });

    if (!utilisateur) {
      // Ne pas révéler si l'email existe ou non
      return res.json({
        success: true,
        message:
          "Si cet email existe, un lien de réinitialisation a été envoyé.",
      });
    }

    // Générer un token de réinitialisation
    const tokenReset = genererTokenReset();
    const expiration = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Stocker temporairement le token (en production, utiliser Redis)
    utilisateur.tokenResetMotDePasse = tokenReset;
    utilisateur.expirationTokenReset = expiration;
    await utilisateur.save();

    // Envoyer l'email de réinitialisation
    await envoyerEmailReset(utilisateur, tokenReset);

    res.json({
      success: true,
      message: "Si cet email existe, un lien de réinitialisation a été envoyé.",
    });
  } catch (error) {
    console.error("Erreur demande reset:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la demande de réinitialisation",
    });
  }
};

/**
 * Réinitialiser le mot de passe
 */
exports.reinitialiserMotDePasse = async (req, res) => {
  try {
    const { token, nouveauMotDePasse } = req.body;

    const utilisateur = await User.findOne({
      tokenResetMotDePasse: token,
      expirationTokenReset: { $gt: new Date() },
    }).select("+motDePasse");

    if (!utilisateur) {
      return res.status(400).json({
        success: false,
        message: "Token invalide ou expiré",
      });
    }

    // Mettre à jour le mot de passe
    utilisateur.motDePasse = nouveauMotDePasse;
    utilisateur.tokenResetMotDePasse = undefined;
    utilisateur.expirationTokenReset = undefined;
    utilisateur.tentativesConnexion = 0;
    utilisateur.compteBloqueJusqua = undefined;

    await utilisateur.save();

    res.json({
      success: true,
      message: "Mot de passe réinitialisé avec succès",
    });
  } catch (error) {
    console.error("Erreur reset mot de passe:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la réinitialisation",
    });
  }
};

/**
 * Vérifier l'email
 */
exports.verifierEmail = async (req, res) => {
  try {
    const { token } = req.params;

    const utilisateur = await User.findOne({
      tokenVerificationEmail: token,
    });

    if (!utilisateur) {
      return res.status(400).json({
        success: false,
        message: "Token de vérification invalide",
      });
    }

    utilisateur.emailVerifie = true;
    utilisateur.tokenVerificationEmail = undefined;
    await utilisateur.save();

    res.json({
      success: true,
      message: "Email vérifié avec succès",
    });
  } catch (error) {
    console.error("Erreur vérification email:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la vérification",
    });
  }
};

/**
 * Déconnexion (côté client principalement)
 */
exports.deconnexion = (req, res) => {
  res.json({
    success: true,
    message: "Déconnexion réussie",
  });
};

// Fonctions utilitaires
async function envoyerEmailVerification(utilisateur) {
  const token = genererTokenReset();
  utilisateur.tokenVerificationEmail = token;
  await utilisateur.save();

  const urlVerification = `${process.env.FRONTEND_URL}/verify-email/${token}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: utilisateur.email,
    subject: "Vérification de votre email - Plateforme de signature",
    html: `
      <h2>Vérification de votre email</h2>
      <p>Bonjour ${utilisateur.prenom} ${utilisateur.nom},</p>
      <p>Merci de vous être inscrit sur notre plateforme de signature électronique.</p>
      <p>Veuillez cliquer sur le lien ci-dessous pour vérifier votre email :</p>
      <a href="${urlVerification}" style="background-color: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
        Vérifier mon email
      </a>
      <p>Ce lien expire dans 24 heures.</p>
      <p>Si vous n'avez pas créé de compte, ignorez cet email.</p>
    `,
  };

  await transporteur.sendMail(mailOptions);
}

async function envoyerEmailReset(utilisateur, token) {
  const urlReset = `${process.env.FRONTEND_URL}/reset-password/${token}`;

  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: utilisateur.email,
    subject: "Réinitialisation de votre mot de passe",
    html: `
      <h2>Réinitialisation de mot de passe</h2>
      <p>Bonjour ${utilisateur.prenom} ${utilisateur.nom},</p>
      <p>Vous avez demandé la réinitialisation de votre mot de passe.</p>
      <p>Cliquez sur le lien ci-dessous pour créer un nouveau mot de passe :</p>
      <a href="${urlReset}" style="background-color: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">
        Réinitialiser mon mot de passe
      </a>
      <p>Ce lien expire dans 30 minutes.</p>
      <p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
    `,
  };

  await transporteur.sendMail(mailOptions);
}
