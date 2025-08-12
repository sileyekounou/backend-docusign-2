const mongoose = require("mongoose");

const signatureSchema = new mongoose.Schema(
  {
    // Référence au document
    document: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: [true, "La référence au document est obligatoire"],
    },

    // Signataire
    signataire: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Le signataire est obligatoire"],
    },

    // Informations de signature
    statut: {
      type: String,
      enum: {
        values: ["en_attente", "signe", "rejete", "annule", "expire"],
        message: "Statut de signature invalide",
      },
      default: "en_attente",
    },

    // Données Dropbox Sign
    dropboxSign: {
      signatureId: String, // ID unique de la signature chez Dropbox Sign
      signatureRequestId: String, // ID de la demande de signature
      signerId: String, // ID du signataire chez Dropbox Sign
      statusCode: String, // Code de statut Dropbox Sign
      signUrl: String, // URL pour signer (temporaire)
      signUrlExpiration: Date, // Expiration de l'URL de signature
      embeddedSignUrl: String, // URL pour signature intégrée
      detailsUrl: String, // URL pour voir les détails de la signature
      signatureEvent: {
        eventType: String, // Type d'événement (signature_request_signed, etc.)
        eventTime: Date,
        eventHash: String,
        eventMetadata: mongoose.Schema.Types.Mixed,
      },
    },

    // Détails de la signature
    methodeSignature: {
      type: String,
      enum: ["electronique", "manuscrite_numerisee", "certificat"],
      default: "electronique",
    },

    // Métadonnées de signature
    dateSignature: Date,
    dateExpiration: Date,
    adresseIP: String,
    userAgent: String,
    geolocalisation: {
      latitude: Number,
      longitude: Number,
      precision: Number,
      adresse: String,
    },

    // Ordre dans le workflow
    ordreSignature: {
      type: Number,
      required: [true, "L'ordre de signature est obligatoire"],
      min: 1,
    },

    // Informations sur le rejet
    motifRejet: String,
    commentaireRejet: String,
    dateRejet: Date,

    // Données biométriques (si applicable)
    donneesSignature: {
      coordonnees: [
        {
          // Points de la signature manuscrite
          x: Number,
          y: Number,
          pression: Number,
          timestamp: Number,
        },
      ],
      dureeSignature: Number, // Durée en millisecondes
      vitesseMoyenne: Number,
      nombreLevees: Number, // Nombre de fois que le stylet a été levé
      hash: String, // Hash des données pour vérification
    },

    // Certificat électronique (si applicable)
    certificat: {
      emetteur: String,
      numeroSerie: String,
      algorithmeHash: String,
      empreinteNumerique: String,
      dateValidite: Date,
      autorite: String,
    },

    // Vérification et intégrité
    hashDocument: String, // Hash du document au moment de la signature
    signatureNumerique: String, // Signature numérique du hash
    timestampServeur: Date,

    // Rappels et notifications
    rappelsEnvoyes: [
      {
        date: Date,
        type: {
          type: String,
          enum: ["email", "sms", "notification"],
        },
        destinataire: String,
        statut: {
          type: String,
          enum: ["envoye", "delivre", "lu", "erreur"],
        },
      },
    ],

    // Délégation (si applicable)
    delegation: {
      deleguePar: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      dateDelegation: Date,
      motifDelegation: String,
      dateExpiration: Date,
    },

    // Audit et conformité
    conformiteRGPD: {
      consentementDonnees: {
        type: Boolean,
        default: false,
      },
      dateConsentement: Date,
      finaliteTraitement: String,
      baseLegale: String,
    },

    // Historique des actions
    historique: [
      {
        action: {
          type: String,
          enum: [
            "creation",
            "envoi",
            "ouverture",
            "signature",
            "rejet",
            "rappel",
            "annulation",
          ],
          required: true,
        },
        date: {
          type: Date,
          default: Date.now,
        },
        utilisateur: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        details: String,
        metadonnees: mongoose.Schema.Types.Mixed,
      },
    ],

    // Métadonnées système
    dateCreation: {
      type: Date,
      default: Date.now,
    },
    dateModification: {
      type: Date,
      default: Date.now,
    },
    creeParUtilisateur: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index pour optimiser les recherches
signatureSchema.index({ document: 1, signataire: 1 }, { unique: true });
signatureSchema.index({ signataire: 1, statut: 1 });
signatureSchema.index({ "dropboxSign.signatureRequestId": 1 });
signatureSchema.index({ "dropboxSign.signerId": 1 });
signatureSchema.index({ dateExpiration: 1 });
signatureSchema.index({ ordreSignature: 1 });

// Middleware pre-save
signatureSchema.pre("save", function (next) {
  this.dateModification = new Date();

  // Définir automatiquement timestampServeur lors de la signature
  if (
    this.isModified("statut") &&
    this.statut === "signe" &&
    !this.timestampServeur
  ) {
    this.timestampServeur = new Date();
  }

  next();
});

// Méthodes d'instance
signatureSchema.methods.ajouterHistorique = function (
  action,
  utilisateur = null,
  details = null,
  metadonnees = null
) {
  this.historique.push({
    action,
    utilisateur,
    details,
    metadonnees,
  });
};

signatureSchema.methods.peutEtreSigne = function () {
  return (
    this.statut === "en_attente" &&
    (!this.dateExpiration || this.dateExpiration > new Date())
  );
};

signatureSchema.methods.estExpire = function () {
  return this.dateExpiration && this.dateExpiration <= new Date();
};

signatureSchema.methods.genererURLSignature = function () {
  // Cette méthode sera utilisée avec le service Dropbox Sign
  // pour générer une URL de signature sécurisée
  if (
    this.dropboxSign &&
    this.dropboxSign.signUrl &&
    this.dropboxSign.signUrlExpiration > new Date()
  ) {
    return this.dropboxSign.signUrl;
  }
  return null;
};

signatureSchema.methods.validerSignatureNumerique = function (donnees) {
  // Validation de l'intégrité de la signature numérique
  // À implémenter selon les besoins de sécurité
  return true;
};

// Méthodes statiques
signatureSchema.statics.obtenirSignaturesEnAttente = function (utilisateurId) {
  return this.find({
    signataire: utilisateurId,
    statut: "en_attente",
    $or: [
      { dateExpiration: { $exists: false } },
      { dateExpiration: { $gt: new Date() } },
    ],
  })
    .populate("document", "titre type categorie dateCreation")
    .populate("creeParUtilisateur", "nom prenom email")
    .sort({ dateCreation: -1 });
};

signatureSchema.statics.obtenirStatistiquesSignature = function (filtres = {}) {
  const pipeline = [
    { $match: filtres },
    {
      $group: {
        _id: "$statut",
        count: { $sum: 1 },
        delaiMoyenSignature: {
          $avg: {
            $cond: [
              { $eq: ["$statut", "signe"] },
              { $subtract: ["$dateSignature", "$dateCreation"] },
              null,
            ],
          },
        },
      },
    },
  ];

  return this.aggregate(pipeline);
};

signatureSchema.statics.nettoyerSignaturesExpirees = function () {
  // Marquer les signatures expirées
  return this.updateMany(
    {
      statut: "en_attente",
      dateExpiration: { $lte: new Date() },
    },
    {
      $set: {
        statut: "expire",
        dateModification: new Date(),
      },
    }
  );
};

// Virtual pour calculer le temps de signature
signatureSchema.virtual("delaiSignature").get(function () {
  if (this.statut === "signe" && this.dateSignature) {
    return this.dateSignature - this.dateCreation;
  }
  return null;
});

// Virtual pour vérifier si la signature est en retard
signatureSchema.virtual("enRetard").get(function () {
  return (
    this.statut === "en_attente" &&
    this.dateExpiration &&
    this.dateExpiration < new Date()
  );
});

signatureSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("Signature", signatureSchema);
