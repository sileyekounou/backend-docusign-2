const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    // Informations de base
    titre: {
      type: String,
      required: [true, "Le titre du document est obligatoire"],
      trim: true,
      maxlength: [200, "Le titre ne peut pas dépasser 200 caractères"],
    },
    description: {
      type: String,
      maxlength: [1000, "La description ne peut pas dépasser 1000 caractères"],
    },

    // Type et catégorie
    type: {
      type: String,
      enum: {
        values: [
          "note",
          "pv",
          "attestation",
          "convention",
          "releve_notes",
          "diplome",
          "autre",
        ],
        message: "Type de document invalide",
      },
      required: [true, "Le type de document est obligatoire"],
    },
    categorie: {
      type: String,
      enum: ["pedagogique", "administratif", "stage", "evaluation"],
      required: [true, "La catégorie est obligatoire"],
    },

    // Fichier
    fichier: {
      nom: {
        type: String,
        required: [true, "Le nom du fichier est obligatoire"],
      },
      nomOriginal: {
        type: String,
        required: [true, "Le nom original du fichier est obligatoire"],
      },
      chemin: {
        type: String,
        required: [true, "Le chemin du fichier est obligatoire"],
      },
      taille: {
        type: Number,
        required: [true, "La taille du fichier est obligatoire"],
      },
      mimeType: {
        type: String,
        required: [true, "Le type MIME est obligatoire"],
        enum: [
          "application/pdf",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/msword",
        ],
      },
      hash: String, // Hash du fichier pour vérifier l'intégrité
    },

    // Créateur et propriétaire
    creeParUtilisateur: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "L'utilisateur créateur est obligatoire"],
    },
    proprietaire: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Étudiants concernés (pour les notes, attestations, etc.)
    etudiantsConcernes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Statut du document
    statut: {
      type: String,
      enum: {
        values: [
          "brouillon",
          "en_attente_signature",
          "partiellement_signe",
          "signe",
          "rejete",
          "archive",
        ],
        message: "Statut invalide",
      },
      default: "brouillon",
    },

    // Workflow de signature
    workflowSignature: [
      {
        utilisateur: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        role: {
          type: String,
          enum: ["signataire", "validateur", "observateur"],
          default: "signataire",
        },
        ordre: {
          type: Number,
          required: true,
          min: 1,
        },
        obligatoire: {
          type: Boolean,
          default: true,
        },
        statut: {
          type: String,
          enum: ["en_attente", "signe", "rejete", "annule"],
          default: "en_attente",
        },
        dateLimite: Date,
        dateSignature: Date,
        commentaire: String,
        adresseIP: String,
      },
    ],

    // Intégration Dropbox Sign
    dropboxSign: {
      signatureRequestId: String, // ID de la demande de signature
      documentId: String, // ID du document chez Dropbox Sign
      templateId: String, // ID du template utilisé
      testMode: {
        type: Boolean,
        default: process.env.NODE_ENV !== "production",
      },
    },

    // Métadonnées pédagogiques
    metadonneesPedagogiques: {
      matiere: String,
      semestre: String,
      anneeUniversitaire: String,
      promotion: String,
      typeEvaluation: {
        type: String,
        enum: ["controle_continu", "examen_final", "tp", "projet", "stage"],
      },
      coefficient: Number,
      noteMinimale: Number,
      noteMaximale: Number,
    },

    // Sécurité et traçabilité
    niveauConfidentialite: {
      type: String,
      enum: ["public", "restreint", "confidentiel"],
      default: "restreint",
    },
    motsCles: [String],

    // Dates importantes
    dateCreation: {
      type: Date,
      default: Date.now,
    },
    dateModification: {
      type: Date,
      default: Date.now,
    },
    dateLimiteSignature: Date,
    dateArchivage: Date,

    // Historique des modifications
    historique: [
      {
        action: {
          type: String,
          enum: [
            "creation",
            "modification",
            "signature",
            "rejet",
            "archivage",
            "suppression",
          ],
          required: true,
        },
        utilisateur: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        date: {
          type: Date,
          default: Date.now,
        },
        details: String,
        anciennesValeurs: mongoose.Schema.Types.Mixed,
      },
    ],

    // Statistiques
    nombreVues: {
      type: Number,
      default: 0,
    },
    nombreTelecharements: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index pour optimiser les recherches
documentSchema.index({ creeParUtilisateur: 1, dateCreation: -1 });
documentSchema.index({ statut: 1 });
documentSchema.index({ type: 1, categorie: 1 });
documentSchema.index({ etudiantsConcernes: 1 });
documentSchema.index({ "workflowSignature.utilisateur": 1 });
documentSchema.index({ "dropboxSign.signatureRequestId": 1 });
documentSchema.index({ titre: "text", description: "text", motsCles: "text" });

// Middleware pre-save
documentSchema.pre("save", function (next) {
  this.dateModification = new Date();
  next();
});

// Méthodes d'instance
documentSchema.methods.ajouterHistorique = function (
  action,
  utilisateur,
  details = null,
  anciennesValeurs = null
) {
  this.historique.push({
    action,
    utilisateur,
    details,
    anciennesValeurs,
  });
};

documentSchema.methods.obtenirProchainSignataire = function () {
  // Retourne le prochain utilisateur qui doit signer
  const prochainSignataire = this.workflowSignature
    .filter((w) => w.statut === "en_attente" && w.obligatoire)
    .sort((a, b) => a.ordre - b.ordre)[0];

  return prochainSignataire ? prochainSignataire.utilisateur : null;
};

documentSchema.methods.estComplétementSigne = function () {
  const signatairesObligatoires = this.workflowSignature.filter(
    (w) => w.obligatoire
  );
  const signaturesCompletes = signatairesObligatoires.filter(
    (w) => w.statut === "signe"
  );

  return (
    signatairesObligatoires.length > 0 &&
    signaturesCompletes.length === signatairesObligatoires.length
  );
};

documentSchema.methods.peutEtreModifiePar = function (utilisateur) {
  // Vérifier si l'utilisateur peut modifier ce document
  return (
    this.creeParUtilisateur.equals(utilisateur._id) ||
    utilisateur.role === "administrateur" ||
    (this.statut === "brouillon" &&
      this.proprietaire &&
      this.proprietaire.equals(utilisateur._id))
  );
};

documentSchema.methods.peutEtreVuPar = function (utilisateur) {
  // Vérifier si l'utilisateur peut voir ce document
  if (utilisateur.role === "administrateur") return true;
  if (this.creeParUtilisateur.equals(utilisateur._id)) return true;
  if (this.proprietaire && this.proprietaire.equals(utilisateur._id))
    return true;
  if (this.etudiantsConcernes.some((id) => id.equals(utilisateur._id)))
    return true;
  if (this.workflowSignature.some((w) => w.utilisateur.equals(utilisateur._id)))
    return true;

  return false;
};

// Méthodes statiques
documentSchema.statics.obtenirDocumentsEnAttente = function (utilisateurId) {
  return this.find({
    workflowSignature: {
      $elemMatch: {
        utilisateur: utilisateurId,
        statut: "en_attente",
      },
    },
  }).populate("creeParUtilisateur", "nom prenom email");
};

documentSchema.statics.rechercherDocuments = function (terme, filtres = {}) {
  const query = {
    $or: [
      { titre: { $regex: terme, $options: "i" } },
      { description: { $regex: terme, $options: "i" } },
      { motsCles: { $in: [new RegExp(terme, "i")] } },
    ],
  };

  // Appliquer les filtres
  Object.keys(filtres).forEach((key) => {
    if (filtres[key] !== undefined && filtres[key] !== null) {
      query[key] = filtres[key];
    }
  });

  return this.find(query)
    .populate("creeParUtilisateur", "nom prenom email")
    .populate("workflowSignature.utilisateur", "nom prenom email")
    .sort({ dateCreation: -1 });
};

// Virtual pour le nom complet du fichier
documentSchema.virtual("fichierComplet").get(function () {
  return {
    ...this.fichier,
    url: `/uploads/${this.fichier.nom}`,
  };
});

documentSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Document", documentSchema);
