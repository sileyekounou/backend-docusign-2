const mongoose = require("mongoose");

// Configuration des options de connexion MongoDB
const mongooseOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  maxPoolSize: 10, // Maintenir jusqu'à 10 connexions dans le pool
  serverSelectionTimeoutMS: 5000, // Timeout après 5s au lieu de 30s
  socketTimeoutMS: 45000, // Fermer les sockets après 45 secondes d'inactivité
  family: 4, // Utiliser IPv4, ignorer IPv6
  bufferMaxEntries: 0, // Désactiver le buffer de mongoose
  bufferCommands: false, // Désactiver le buffer des commandes mongoose
};

// Configuration des index pour optimiser les performances
const configurationIndex = {
  // Index pour les utilisateurs
  users: [
    { email: 1 }, // Index unique automatique
    { role: 1 },
    { etablissement: 1 },
    { numeroEtudiant: 1 },
    { nom: "text", prenom: "text", email: "text" }, // Index de recherche textuelle
    { dateCreation: -1 },
  ],

  // Index pour les documents
  documents: [
    { creeParUtilisateur: 1, dateCreation: -1 },
    { statut: 1 },
    { type: 1, categorie: 1 },
    { etudiantsConcernes: 1 },
    { "workflowSignature.utilisateur": 1 },
    { "dropboxSign.signatureRequestId": 1 },
    { titre: "text", description: "text", motsCles: "text" }, // Index de recherche textuelle
    { dateCreation: -1 },
    { dateLimiteSignature: 1 },
  ],

  // Index pour les signatures
  signatures: [
    { document: 1, signataire: 1 }, // Index composé unique
    { signataire: 1, statut: 1 },
    { "dropboxSign.signatureRequestId": 1 },
    { "dropboxSign.signerId": 1 },
    { dateExpiration: 1 },
    { ordreSignature: 1 },
    { dateCreation: -1 },
  ],
};

class DatabaseConfig {
  constructor() {
    this.isConnected = false;
    this.connectionString = this.buildConnectionString();
  }

  /**
   * Construire la chaîne de connexion MongoDB
   */
  buildConnectionString() {
    const {
      MONGODB_URI,
      MONGODB_HOST = "localhost",
      MONGODB_PORT = "27017",
      MONGODB_DATABASE = "signature-platform",
      MONGODB_USERNAME,
      MONGODB_PASSWORD,
      MONGODB_AUTH_SOURCE = "admin",
    } = process.env;

    // Si MONGODB_URI est fourni, l'utiliser directement
    if (MONGODB_URI) {
      return MONGODB_URI;
    }

    // Sinon, construire l'URI à partir des composants
    let uri = "mongodb://";

    if (MONGODB_USERNAME && MONGODB_PASSWORD) {
      uri += `${MONGODB_USERNAME}:${MONGODB_PASSWORD}@`;
    }

    uri += `${MONGODB_HOST}:${MONGODB_PORT}/${MONGODB_DATABASE}`;

    if (MONGODB_USERNAME && MONGODB_PASSWORD) {
      uri += `?authSource=${MONGODB_AUTH_SOURCE}`;
    }

    return uri;
  }

  /**
   * Se connecter à MongoDB
   */
  async connect() {
    try {
      if (this.isConnected) {
        console.log("💾 Déjà connecté à MongoDB");
        return;
      }

      console.log("🔌 Connexion à MongoDB...");
      console.log(
        `📍 URI: ${this.connectionString.replace(/\/\/.*@/, "//***:***@")}`
      );

      await mongoose.connect(this.connectionString, mongooseOptions);

      this.isConnected = true;
      console.log("✅ Connexion à MongoDB réussie");

      // Configurer les événements de connexion
      this.setupConnectionEvents();

      // Créer les index après la connexion
      await this.createIndexes();

      // Optionnel: Effectuer une vérification de santé
      await this.healthCheck();
    } catch (error) {
      console.error("❌ Erreur de connexion à MongoDB:", error.message);

      // Retry logic (optionnel)
      if (process.env.NODE_ENV === "production") {
        console.log("🔄 Tentative de reconnexion dans 5 secondes...");
        setTimeout(() => this.connect(), 5000);
      } else {
        throw error;
      }
    }
  }

  /**
   * Configurer les événements de connexion MongoDB
   */
  setupConnectionEvents() {
    // Connexion établie
    mongoose.connection.on("connected", () => {
      console.log("🟢 MongoDB connecté");
      this.isConnected = true;
    });

    // Erreur de connexion
    mongoose.connection.on("error", (error) => {
      console.error("🔴 Erreur MongoDB:", error.message);
      this.isConnected = false;
    });

    // Connexion fermée
    mongoose.connection.on("disconnected", () => {
      console.log("🟡 MongoDB déconnecté");
      this.isConnected = false;
    });

    // Reconnexion réussie
    mongoose.connection.on("reconnected", () => {
      console.log("🔄 MongoDB reconnecté");
      this.isConnected = true;
    });

    // Gestion de l'arrêt gracieux
    process.on("SIGINT", this.gracefulShutdown.bind(this));
    process.on("SIGTERM", this.gracefulShutdown.bind(this));
  }

  /**
   * Créer les index pour optimiser les performances
   */
  async createIndexes() {
    try {
      console.log("📊 Création des index de base de données...");

      const collections = Object.keys(configurationIndex);

      for (const collectionName of collections) {
        const indexes = configurationIndex[collectionName];

        for (const indexSpec of indexes) {
          try {
            await mongoose.connection.db
              .collection(collectionName)
              .createIndex(indexSpec);
          } catch (error) {
            // Ignorer les erreurs d'index déjà existants
            if (!error.message.includes("already exists")) {
              console.warn(
                `⚠️ Erreur création index ${collectionName}:`,
                error.message
              );
            }
          }
        }
      }

      console.log("✅ Index créés avec succès");
    } catch (error) {
      console.error("❌ Erreur création des index:", error.message);
    }
  }

  /**
   * Vérification de santé de la base de données
   */
  async healthCheck() {
    try {
      const admin = mongoose.connection.db.admin();
      const status = await admin.ping();

      if (status.ok === 1) {
        console.log("💚 Base de données en bonne santé");

        // Afficher quelques statistiques
        const stats = await mongoose.connection.db.stats();
        console.log(
          `📈 Collections: ${stats.collections}, Documents: ${
            stats.objects
          }, Taille: ${(stats.dataSize / 1024 / 1024).toFixed(2)} MB`
        );

        return true;
      }

      return false;
    } catch (error) {
      console.error("❌ Échec de la vérification de santé:", error.message);
      return false;
    }
  }

  /**
   * Arrêt gracieux de la connexion
   */
  async gracefulShutdown(signal) {
    console.log(
      `\n🛑 Signal ${signal} reçu. Fermeture de la connexion MongoDB...`
    );

    try {
      await mongoose.connection.close();
      console.log("✅ Connexion MongoDB fermée proprement");
      process.exit(0);
    } catch (error) {
      console.error("❌ Erreur lors de la fermeture:", error.message);
      process.exit(1);
    }
  }

  /**
   * Obtenir les statistiques de la base de données
   */
  async getStats() {
    try {
      if (!this.isConnected) {
        throw new Error("Base de données non connectée");
      }

      const stats = await mongoose.connection.db.stats();
      const collections = await mongoose.connection.db
        .listCollections()
        .toArray();

      const detailedStats = {
        database: {
          name: mongoose.connection.db.databaseName,
          collections: stats.collections,
          objects: stats.objects,
          avgObjSize: stats.avgObjSize,
          dataSize: stats.dataSize,
          storageSize: stats.storageSize,
          indexes: stats.indexes,
          indexSize: stats.indexSize,
        },
        collections: [],
      };

      // Statistiques par collection
      for (const collection of collections) {
        try {
          const collStats = await mongoose.connection.db
            .collection(collection.name)
            .stats();

          detailedStats.collections.push({
            name: collection.name,
            count: collStats.count,
            size: collStats.size,
            avgObjSize: collStats.avgObjSize,
            storageSize: collStats.storageSize,
            indexes: collStats.nindexes,
            indexSize: collStats.totalIndexSize,
          });
        } catch (error) {
          // Ignorer les erreurs pour les collections système
          console.warn(
            `⚠️ Impossible d'obtenir les stats pour ${collection.name}`
          );
        }
      }

      return detailedStats;
    } catch (error) {
      console.error("Erreur obtention statistiques:", error);
      throw error;
    }
  }

  /**
   * Effectuer une sauvegarde de la base de données
   */
  async backup(outputPath) {
    try {
      const { spawn } = require("child_process");
      const path = require("path");

      const backupPath =
        outputPath ||
        path.join(process.cwd(), "backups", `backup-${Date.now()}`);

      console.log(`💾 Démarrage de la sauvegarde vers: ${backupPath}`);

      return new Promise((resolve, reject) => {
        const mongodump = spawn("mongodump", [
          "--uri",
          this.connectionString,
          "--out",
          backupPath,
        ]);

        mongodump.stdout.on("data", (data) => {
          console.log(`📝 ${data}`);
        });

        mongodump.stderr.on("data", (data) => {
          console.error(`❌ ${data}`);
        });

        mongodump.on("close", (code) => {
          if (code === 0) {
            console.log("✅ Sauvegarde terminée avec succès");
            resolve(backupPath);
          } else {
            reject(new Error(`Échec de la sauvegarde (code: ${code})`));
          }
        });
      });
    } catch (error) {
      console.error("Erreur sauvegarde:", error);
      throw error;
    }
  }

  /**
   * Nettoyer les anciennes données
   */
  async cleanup(daysToKeep = 90) {
    try {
      console.log(`🧹 Nettoyage des données de plus de ${daysToKeep} jours...`);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      // Supprimer les anciens logs (si vous en avez)
      // await mongoose.connection.db.collection('logs').deleteMany({
      //   dateCreation: { $lt: cutoffDate }
      // });

      // Archiver les anciens documents signés
      const Document = require("../models/Document");
      const anciensDocuments = await Document.updateMany(
        {
          statut: "signe",
          dateCreation: { $lt: cutoffDate },
          statut: { $ne: "archive" },
        },
        {
          $set: {
            statut: "archive",
            dateArchivage: new Date(),
          },
        }
      );

      console.log(`📄 ${anciensDocuments.modifiedCount} documents archivés`);

      // Nettoyer les signatures expirées
      const Signature = require("../models/Signature");
      const signaturesNettoyees = await Signature.nettoyerSignaturesExpirees();

      console.log(
        `✏️ ${signaturesNettoyees.modifiedCount} signatures expirées nettoyées`
      );

      console.log("✅ Nettoyage terminé");
    } catch (error) {
      console.error("Erreur nettoyage:", error);
      throw error;
    }
  }

  /**
   * Vérifier l'état de la connexion
   */
  isHealthy() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }

  /**
   * Obtenir les informations de connexion (sans données sensibles)
   */
  getConnectionInfo() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name,
      states: {
        0: "disconnected",
        1: "connected",
        2: "connecting",
        3: "disconnecting",
      }[mongoose.connection.readyState],
    };
  }
}

// Export singleton
module.exports = new DatabaseConfig();
