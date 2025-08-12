/**
 * Middleware pour vérifier les rôles d'utilisateur
 */

/**
 * Vérifier qu'un utilisateur a un des rôles autorisés
 * @param {string|Array} rolesAutorises - Rôle unique ou tableau de rôles autorisés
 */
exports.verifierRole = (rolesAutorises) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentification requise",
      });
    }

    // Convertir en tableau si c'est une chaîne
    const roles = Array.isArray(rolesAutorises)
      ? rolesAutorises
      : [rolesAutorises];

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "Accès refusé. Permissions insuffisantes.",
        roleRequis: roles,
        roleActuel: req.user.role,
      });
    }

    next();
  };
};

/**
 * Middleware spécifique pour les administrateurs
 */
exports.estAdministrateur = (req, res, next) => {
  return exports.verifierRole("administrateur")(req, res, next);
};

/**
 * Middleware pour les enseignants et plus
 */
exports.estEnseignantOuPlus = (req, res, next) => {
  return exports.verifierRole([
    "enseignant",
    "responsable_pedagogique",
    "administrateur",
  ])(req, res, next);
};

/**
 * Middleware pour les responsables pédagogiques et plus
 */
exports.estResponsableOuPlus = (req, res, next) => {
  return exports.verifierRole(["responsable_pedagogique", "administrateur"])(
    req,
    res,
    next
  );
};

/**
 * Middleware pour vérifier les permissions sur les documents selon le rôle
 */
exports.verifierPermissionsDocument = (action) => {
  return async (req, res, next) => {
    try {
      const { user } = req;
      const documentId = req.params.id || req.body.documentId;

      if (!documentId) {
        return res.status(400).json({
          success: false,
          message: "ID du document manquant",
        });
      }

      // Charger le document s'il n'est pas déjà dans req.resource
      let document = req.resource;
      if (!document) {
        const Document = require("../models/Document");
        document = await Document.findById(documentId)
          .populate("creeParUtilisateur")
          .populate("etudiantsConcernes")
          .populate("workflowSignature.utilisateur");

        if (!document) {
          return res.status(404).json({
            success: false,
            message: "Document non trouvé",
          });
        }
      }

      let autorise = false;

      switch (action) {
        case "lire":
          autorise = peutLireDocument(user, document);
          break;
        case "modifier":
          autorise = peutModifierDocument(user, document);
          break;
        case "supprimer":
          autorise = peutSupprimerDocument(user, document);
          break;
        case "signer":
          autorise = peutSignerDocument(user, document);
          break;
        case "gerer_workflow":
          autorise = peutGererWorkflow(user, document);
          break;
        default:
          return res.status(400).json({
            success: false,
            message: "Action non reconnue",
          });
      }

      if (!autorise) {
        return res.status(403).json({
          success: false,
          message: `Vous n'êtes pas autorisé à ${action} ce document`,
        });
      }

      // Attacher le document à la requête
      req.document = document;
      next();
    } catch (error) {
      console.error("Erreur vérification permissions document:", error);
      res.status(500).json({
        success: false,
        message: "Erreur de vérification des permissions",
      });
    }
  };
};

/**
 * Middleware pour vérifier les permissions sur les utilisateurs
 */
exports.verifierPermissionsUtilisateur = (action) => {
  return async (req, res, next) => {
    try {
      const { user } = req;
      const utilisateurCibleId = req.params.id || req.body.utilisateurId;

      // Règles générales
      switch (action) {
        case "lire_profil":
          // Tout le monde peut lire son propre profil
          // Admins et responsables peuvent lire tous les profils
          if (
            utilisateurCibleId === user._id.toString() ||
            ["administrateur", "responsable_pedagogique"].includes(user.role)
          ) {
            return next();
          }
          break;

        case "modifier_profil":
          // Seuls les admins peuvent modifier les profils des autres
          if (
            utilisateurCibleId === user._id.toString() ||
            user.role === "administrateur"
          ) {
            return next();
          }
          break;

        case "creer_utilisateur":
          // Seuls les admins et responsables peuvent créer des utilisateurs
          if (
            ["administrateur", "responsable_pedagogique"].includes(user.role)
          ) {
            return next();
          }
          break;

        case "supprimer_utilisateur":
          // Seuls les admins peuvent supprimer
          if (user.role === "administrateur") {
            return next();
          }
          break;

        case "lister_utilisateurs":
          // Admins et responsables peuvent lister
          if (
            ["administrateur", "responsable_pedagogique"].includes(user.role)
          ) {
            return next();
          }
          break;
      }

      return res.status(403).json({
        success: false,
        message: "Permissions insuffisantes pour cette action",
      });
    } catch (error) {
      console.error("Erreur vérification permissions utilisateur:", error);
      res.status(500).json({
        success: false,
        message: "Erreur de vérification des permissions",
      });
    }
  };
};

/**
 * Middleware pour les actions de signature
 */
exports.verifierPermissionsSignature = (action) => {
  return async (req, res, next) => {
    try {
      const { user } = req;
      const signatureId = req.params.id;

      const Signature = require("../models/Signature");
      const signature = await Signature.findById(signatureId)
        .populate("document")
        .populate("signataire")
        .populate("creeParUtilisateur");

      if (!signature) {
        return res.status(404).json({
          success: false,
          message: "Signature non trouvée",
        });
      }

      let autorise = false;

      switch (action) {
        case "lire":
          // Le signataire, le créateur ou un admin peut lire
          autorise =
            signature.signataire._id.equals(user._id) ||
            signature.creeParUtilisateur._id.equals(user._id) ||
            user.role === "administrateur";
          break;

        case "signer":
          // Seul le signataire désigné peut signer
          autorise =
            signature.signataire._id.equals(user._id) &&
            signature.statut === "en_attente";
          break;

        case "rejeter":
          // Seul le signataire peut rejeter
          autorise =
            signature.signataire._id.equals(user._id) &&
            signature.statut === "en_attente";
          break;

        case "rappeler":
          // Le créateur ou un admin peut envoyer des rappels
          autorise =
            signature.creeParUtilisateur._id.equals(user._id) ||
            user.role === "administrateur";
          break;

        case "annuler":
          // Le créateur ou un admin peut annuler
          autorise =
            signature.creeParUtilisateur._id.equals(user._id) ||
            user.role === "administrateur";
          break;
      }

      if (!autorise) {
        return res.status(403).json({
          success: false,
          message: `Vous n'êtes pas autorisé à ${action} cette signature`,
        });
      }

      req.signature = signature;
      next();
    } catch (error) {
      console.error("Erreur vérification permissions signature:", error);
      res.status(500).json({
        success: false,
        message: "Erreur de vérification des permissions",
      });
    }
  };
};

// Fonctions utilitaires pour les permissions sur les documents

function peutLireDocument(user, document) {
  // Administrateurs peuvent tout lire
  if (user.role === "administrateur") return true;

  // Créateur peut lire ses documents
  if (document.creeParUtilisateur._id.equals(user._id)) return true;

  // Étudiants concernés peuvent lire
  if (
    document.etudiantsConcernes.some((etudiant) =>
      etudiant._id.equals(user._id)
    )
  )
    return true;

  // Signataires peuvent lire
  if (
    document.workflowSignature.some((w) => w.utilisateur._id.equals(user._id))
  )
    return true;

  // Responsables pédagogiques peuvent lire les documents pédagogiques
  if (
    user.role === "responsable_pedagogique" &&
    document.categorie === "pedagogique"
  )
    return true;

  return false;
}

function peutModifierDocument(user, document) {
  // Administrateurs peuvent tout modifier
  if (user.role === "administrateur") return true;

  // Seul le créateur peut modifier, et seulement si le document est en brouillon
  return (
    document.creeParUtilisateur._id.equals(user._id) &&
    document.statut === "brouillon"
  );
}

function peutSupprimerDocument(user, document) {
  // Seuls les administrateurs peuvent supprimer
  if (user.role === "administrateur") return true;

  // Le créateur peut supprimer seulement si le document est en brouillon
  return (
    document.creeParUtilisateur._id.equals(user._id) &&
    document.statut === "brouillon"
  );
}

function peutSignerDocument(user, document) {
  // Vérifier si l'utilisateur est dans le workflow de signature
  const signataireWorkflow = document.workflowSignature.find((w) =>
    w.utilisateur._id.equals(user._id)
  );

  return signataireWorkflow && signataireWorkflow.statut === "en_attente";
}

function peutGererWorkflow(user, document) {
  // Administrateurs et responsables peuvent gérer les workflows
  if (["administrateur", "responsable_pedagogique"].includes(user.role))
    return true;

  // Le créateur peut gérer le workflow de ses documents
  return document.creeParUtilisateur._id.equals(user._id);
}

/**
 * Middleware pour journaliser les actions sensibles avec rôles
 */
exports.journaliserActionAvecRole = (action) => {
  return (req, res, next) => {
    const originalSend = res.send;

    res.send = function (data) {
      if (res.statusCode < 400) {
        const logData = {
          timestamp: new Date().toISOString(),
          action,
          utilisateur: {
            id: req.user?._id,
            email: req.user?.email,
            role: req.user?.role,
          },
          ip: req.ip,
          userAgent: req.get("User-Agent"),
          resource: {
            type: req.baseUrl.split("/").pop(),
            id: req.params.id,
          },
        };

        console.log("[AUDIT-ROLE]", JSON.stringify(logData));

        // En production, envoyer vers un service d'audit sécurisé
      }

      originalSend.call(this, data);
    };

    next();
  };
};

/**
 * Middleware pour valider la hiérarchie des rôles dans les opérations
 */
exports.verifierHierarchieRoles = (req, res, next) => {
  const { user } = req;
  const { role: nouveauRole } = req.body;

  if (!nouveauRole) {
    return next();
  }

  const hierarchie = {
    etudiant: 0,
    enseignant: 1,
    responsable_pedagogique: 2,
    administrateur: 3,
  };

  const niveauActuel = hierarchie[user.role] || 0;
  const niveauCible = hierarchie[nouveauRole] || 0;

  // Un utilisateur ne peut pas attribuer un rôle supérieur au sien
  if (niveauCible > niveauActuel) {
    return res.status(403).json({
      success: false,
      message: "Vous ne pouvez pas attribuer un rôle supérieur au vôtre",
    });
  }

  next();
};
