const jwt = require("jsonwebtoken");
const User = require("../models/User");

/**
 * Middleware d'authentification JWT
 */
exports.authentifier = async (req, res, next) => {
  try {
    // Récupérer le token depuis les headers
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Accès refusé. Token manquant.",
      });
    }

    const token = authHeader.substring(7); // Retirer "Bearer "

    try {
      // Vérifier et décoder le token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Récupérer l'utilisateur
      const utilisateur = await User.findById(decoded.userId);

      if (!utilisateur) {
        return res.status(401).json({
          success: false,
          message: "Token invalide. Utilisateur non trouvé.",
        });
      }

      // Vérifier que le compte est actif
      if (utilisateur.statut !== "actif") {
        return res.status(403).json({
          success: false,
          message: "Compte inactif ou suspendu.",
        });
      }

      // Vérifier que le compte n'est pas bloqué
      if (
        utilisateur.compteBloqueJusqua &&
        utilisateur.compteBloqueJusqua > new Date()
      ) {
        return res.status(423).json({
          success: false,
          message: "Compte temporairement bloqué.",
          bloqueJusqua: utilisateur.compteBloqueJusqua,
        });
      }

      // Ajouter l'utilisateur à la requête
      req.user = utilisateur;
      next();
    } catch (jwtError) {
      if (jwtError.name === "TokenExpiredError") {
        return res.status(401).json({
          success: false,
          message: "Token expiré. Veuillez vous reconnecter.",
        });
      } else if (jwtError.name === "JsonWebTokenError") {
        return res.status(401).json({
          success: false,
          message: "Token invalide.",
        });
      } else {
        throw jwtError;
      }
    }
  } catch (error) {
    console.error("Erreur middleware auth:", error);
    res.status(500).json({
      success: false,
      message: "Erreur d'authentification",
    });
  }
};

/**
 * Middleware d'authentification optionnelle
 * Ajoute l'utilisateur à req.user s'il est connecté, sinon continue
 */
exports.authentifierOptionnel = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      // Pas de token, mais on continue
      req.user = null;
      return next();
    }

    const token = authHeader.substring(7);

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const utilisateur = await User.findById(decoded.userId);

      if (utilisateur && utilisateur.statut === "actif") {
        req.user = utilisateur;
      } else {
        req.user = null;
      }
    } catch (jwtError) {
      // Token invalide, mais on continue sans utilisateur
      req.user = null;
    }

    next();
  } catch (error) {
    console.error("Erreur middleware auth optionnel:", error);
    req.user = null;
    next();
  }
};

/**
 * Middleware pour vérifier que l'email est vérifié
 */
exports.emailVerifieRequis = (req, res, next) => {
  if (!req.user.emailVerifie && req.path !== "/verify-email") {
    return res.status(403).json({
      success: false,
      message:
        "Email non vérifié. Veuillez vérifier votre email avant de continuer.",
      code: "EMAIL_NOT_VERIFIED",
    });
  }
  next();
};

/**
 * Middleware de limitation de taux (rate limiting) par utilisateur
 */
exports.rateLimitParUtilisateur = (
  maxRequetes = 100,
  fenetreTemporeMS = 15 * 60 * 1000
) => {
  const utilisateursRequetes = new Map();

  return (req, res, next) => {
    if (!req.user) {
      return next(); // Pas de limite pour les utilisateurs non connectés
    }

    const userId = req.user._id.toString();
    const maintenant = Date.now();

    // Nettoyer les anciennes entrées
    if (utilisateursRequetes.has(userId)) {
      const donneesUtilisateur = utilisateursRequetes.get(userId);
      donneesUtilisateur.requetes = donneesUtilisateur.requetes.filter(
        (timestamp) => maintenant - timestamp < fenetreTemporeMS
      );
    } else {
      utilisateursRequetes.set(userId, { requetes: [] });
    }

    const donneesUtilisateur = utilisateursRequetes.get(userId);

    // Vérifier la limite
    if (donneesUtilisateur.requetes.length >= maxRequetes) {
      return res.status(429).json({
        success: false,
        message: "Trop de requêtes. Veuillez réessayer plus tard.",
        retryAfter: Math.ceil(fenetreTemporeMS / 1000),
      });
    }

    // Ajouter la requête actuelle
    donneesUtilisateur.requetes.push(maintenant);

    next();
  };
};

/**
 * Middleware pour journaliser les actions sensibles
 */
exports.journaliserAction = (action) => {
  return (req, res, next) => {
    // Intercepter la réponse pour journaliser après le traitement
    const originalSend = res.send;

    res.send = function (data) {
      // Journaliser uniquement si la requête a réussi
      if (res.statusCode < 400) {
        console.log(
          `[AUDIT] ${action} - Utilisateur: ${
            req.user?.email || "Anonyme"
          } - IP: ${req.ip} - ${new Date().toISOString()}`
        );

        // En production, utiliser un système de logging approprié
        // comme Winston ou envoyer vers un service d'audit
      }

      originalSend.call(this, data);
    };

    next();
  };
};

/**
 * Middleware pour vérifier les permissions sur les ressources
 */
exports.verifierPropriete = (
  modelName,
  paramName = "id",
  champPropriete = "creeParUtilisateur"
) => {
  return async (req, res, next) => {
    try {
      const Model = require(`../models/${modelName}`);
      const resourceId = req.params[paramName];

      const resource = await Model.findById(resourceId);

      if (!resource) {
        return res.status(404).json({
          success: false,
          message: "Ressource non trouvée",
        });
      }

      // Vérifier la propriété ou les permissions spéciales
      const estProprietaire =
        resource[champPropriete] &&
        resource[champPropriete].equals(req.user._id);
      const estAdmin = req.user.role === "administrateur";

      if (!estProprietaire && !estAdmin) {
        return res.status(403).json({
          success: false,
          message:
            "Accès refusé. Vous n'êtes pas autorisé à accéder à cette ressource.",
        });
      }

      // Attacher la ressource à la requête pour éviter une autre recherche
      req.resource = resource;
      next();
    } catch (error) {
      console.error("Erreur vérification propriété:", error);
      res.status(500).json({
        success: false,
        message: "Erreur de vérification des permissions",
      });
    }
  };
};

/**
 * Middleware pour gérer les erreurs d'authentification dans les routes protégées
 */
exports.gererErreursAuth = (err, req, res, next) => {
  if (err.name === "UnauthorizedError") {
    return res.status(401).json({
      success: false,
      message: "Token invalide ou expiré",
    });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Session expirée. Veuillez vous reconnecter.",
    });
  }

  next(err);
};

/**
 * Middleware pour vérifier les permissions d'API selon l'environnement
 */
exports.verifierEnvironnement = (
  environments = ["development", "production"]
) => {
  return (req, res, next) => {
    const currentEnv = process.env.NODE_ENV || "development";

    if (!environments.includes(currentEnv)) {
      return res.status(403).json({
        success: false,
        message:
          "Cette fonctionnalité n'est pas disponible dans cet environnement",
      });
    }

    next();
  };
};

/**
 * Middleware pour forcer HTTPS en production
 */
exports.forcerHTTPS = (req, res, next) => {
  if (
    process.env.NODE_ENV === "production" &&
    !req.secure &&
    req.get("x-forwarded-proto") !== "https"
  ) {
    return res.redirect(`https://${req.get("host")}${req.url}`);
  }
  next();
};
