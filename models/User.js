const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    // Informations personnelles
    nom: {
      type: String,
      required: [true, "Le nom est obligatoire"],
      trim: true,
      maxlength: [50, "Le nom ne peut pas dépasser 50 caractères"],
    },
    prenom: {
      type: String,
      required: [true, "Le prénom est obligatoire"],
      trim: true,
      maxlength: [50, "Le prénom ne peut pas dépasser 50 caractères"],
    },
    email: {
      type: String,
      required: [true, "L'email est obligatoire"],
      unique: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, "Email invalide"],
    },
    telephone: {
      type: String,
      match: [/^(\+33|0)[1-9](\d{8})$/, "Numéro de téléphone invalide"],
    },

    // Authentification
    motDePasse: {
      type: String,
      required: [true, "Le mot de passe est obligatoire"],
      minlength: [8, "Le mot de passe doit contenir au moins 8 caractères"],
      select: false, // Ne pas inclure dans les requêtes par défaut
    },

    // Rôle et permissions
    role: {
      type: String,
      enum: {
        values: [
          "administrateur",
          "enseignant",
          "responsable_pedagogique",
          "etudiant",
        ],
        message: "Rôle invalide",
      },
      required: [true, "Le rôle est obligatoire"],
    },

    // Informations professionnelles
    etablissement: {
      type: String,
      required: function () {
        return this.role !== "etudiant";
      },
      validate: {
        validator: function (value) {
          if (this.role === "etudiant") {
            // Pour les étudiants, peut être optionnel
            return true;
          }
          // Pour les autres rôles, requis et non vide
          return value && value.trim().length > 0;
        },
        message: "Établissement requis pour ce rôle",
      },
    },
    departement: String,
    specialite: String,

    // Informations étudiant
    numeroEtudiant: {
      type: String,
      unique: true,
      sparse: true, // Permet les valeurs null/undefined
      required: function () {
        return this.role === "etudiant";
      },
      validate: {
        validator: function (value) {
          // Si c'est un étudiant, le numéro est requis et non vide
          if (this.role === "etudiant") {
            return value && value.trim().length > 0;
          }
          // Si ce n'est pas un étudiant, doit être null ou undefined
          return value === null || value === undefined;
        },
        message: "Numéro étudiant invalide pour ce rôle",
      },
    },
    promotion: {
      type: String,
      required: function () {
        return this.role === "etudiant";
      },
    },

    // Statut et sécurité
    statut: {
      type: String,
      enum: ["actif", "inactif", "suspendu"],
      default: "actif",
    },
    emailVerifie: {
      type: Boolean,
      default: false,
    },
    dernierLogin: Date,
    tentativesConnexion: {
      type: Number,
      default: 0,
    },
    compteBloqueJusqua: Date,

    // Signature électronique
    signatureDropboxId: String, // ID utilisateur chez Dropbox Sign

    // Métadonnées
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
    },
  },
  {
    timestamps: true,
  }
);

// Index pour optimiser les recherches
userSchema.index({ email: 1 }, { unique: true });
userSchema.index(
  { numeroEtudiant: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      numeroEtudiant: { $exists: true, $ne: null, $ne: "" },
    },
  }
);
userSchema.index({ role: 1 });
userSchema.index({ nom: "text", prenom: "text" });

// Middleware pre-save pour hasher le mot de passe
userSchema.pre("save", async function (next) {
  try {
    // Nettoyer les champs selon le rôle
    if (this.role === "etudiant") {
      // Pour les étudiants, s'assurer que le numéro étudiant est valide
      if (!this.numeroEtudiant || this.numeroEtudiant.trim() === "") {
        return next(new Error("Numéro étudiant requis pour les étudiants"));
      }
      this.numeroEtudiant = this.numeroEtudiant.trim();
    } else {
      // Pour les non-étudiants, forcer à null
      this.numeroEtudiant = null;
      this.promotion = null;
    }

    // Nettoyer les chaînes vides
    ["etablissement", "departement", "specialite", "telephone"].forEach(
      (field) => {
        if (this[field] === "") {
          this[field] = null;
        }
      }
    );

    // Hasher le mot de passe si modifié
    if (this.isModified("motDePasse")) {
      const salt = await bcrypt.genSalt(12);
      this.motDePasse = await bcrypt.hash(this.motDePasse, salt);
    }

    this.dateModification = new Date();
    next();
  } catch (error) {
    next(error);
  }
});
// Méthode pour comparer les mots de passe
userSchema.methods.verifierMotDePasse = async function (motDePasseCandidat) {
  return await bcrypt.compare(motDePasseCandidat, this.motDePasse);
};

userSchema.methods.nettoyerDonnees = function () {
  // Nettoyer selon le rôle
  if (this.role !== "etudiant") {
    this.numeroEtudiant = null;
    this.promotion = null;
  }

  // Nettoyer les chaînes vides
  ["etablissement", "departement", "specialite", "telephone"].forEach(
    (field) => {
      if (this[field] === "") {
        this[field] = null;
      }
    }
  );

  return this;
};

// Méthode pour obtenir les informations publiques de l'utilisateur
userSchema.methods.toPublicJSON = function () {
  return {
    _id: this._id,
    nom: this.nom,
    prenom: this.prenom,
    email: this.email,
    role: this.role,
    etablissement: this.etablissement,
    departement: this.departement,
    statut: this.statut,
    emailVerifie: this.emailVerifie,
    dateCreation: this.dateCreation,
  };
};

// Méthode statique pour rechercher des utilisateurs
userSchema.statics.rechercherUtilisateurs = function (terme, role = null) {
  const query = {
    $or: [
      { nom: { $regex: terme, $options: "i" } },
      { prenom: { $regex: terme, $options: "i" } },
      { email: { $regex: terme, $options: "i" } },
    ],
  };

  if (role) {
    query.role = role;
  }

  return this.find(query).select("-motDePasse");
};

// Virtual pour le nom complet
userSchema.virtual("nomComplet").get(function () {
  return `${this.prenom} ${this.nom}`;
});

// Assurer que les virtuals sont inclus dans JSON
userSchema.set("toJSON", { virtuals: true });

module.exports = mongoose.model("User", userSchema);
