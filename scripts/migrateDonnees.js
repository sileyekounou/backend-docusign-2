// scripts/migrateDonnees.js
// Script à exécuter UNE FOIS pour nettoyer les données existantes

const mongoose = require("mongoose");
require("dotenv").config();

// Connecter à MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const User = require("../models/User");

async function migrerDonnees() {
  try {
    console.log("Début de la migration des données...");

    // 1. Trouver tous les utilisateurs avec des champs vides problématiques
    const utilisateursAvecChampsVides = await User.find({
      $or: [
        { numeroEtudiant: "" },
        { etablissement: "" },
        { departement: "" },
        { specialite: "" },
        { telephone: "" },
        { promotion: "" },
      ],
    });

    console.log(
      `Trouvé ${utilisateursAvecChampsVides.length} utilisateur(s) avec des champs vides`
    );

    let compteurMisAJour = 0;

    for (const utilisateur of utilisateursAvecChampsVides) {
      console.log(
        `Migration de l'utilisateur: ${utilisateur.email} (${utilisateur.role})`
      );

      let misAJour = false;

      // Nettoyer selon le rôle
      if (utilisateur.role !== "etudiant") {
        // Pour les non-étudiants, supprimer les champs étudiants
        if (utilisateur.numeroEtudiant === "") {
          utilisateur.numeroEtudiant = null;
          misAJour = true;
        }
        if (utilisateur.promotion === "") {
          utilisateur.promotion = null;
          misAJour = true;
        }
      } else {
        // Pour les étudiants, vérifier la cohérence
        if (utilisateur.numeroEtudiant === "") {
          console.warn(`Étudiant sans numéro: ${utilisateur.email}`);
          // Générer un numéro temporaire ou demander une correction manuelle
          utilisateur.numeroEtudiant = `TEMP_${Date.now()}`;
          misAJour = true;
        }
      }

      // Nettoyer les autres champs vides
      [
        "etablissement",
        "departement",
        "specialite",
        "telephone",
        "promotion",
      ].forEach((champ) => {
        if (utilisateur[champ] === "") {
          utilisateur[champ] = null;
          misAJour = true;
        }
      });

      if (misAJour) {
        try {
          // Sauvegarder avec validation désactivée pour éviter les erreurs
          await utilisateur.save({ validateBeforeSave: false });
          compteurMisAJour++;
          console.log(`Utilisateur ${utilisateur.email} migré avec succès`);
        } catch (error) {
          console.error(
            `Erreur migration ${utilisateur.email}:`,
            error.message
          );
        }
      }
    }

    console.log(`\nMigration terminée !`);
    console.log(`${compteurMisAJour} utilisateur(s) mis à jour`);

    // 2. Vérifier s'il reste des problèmes
    const problemesRestants = await User.find({
      $or: [
        { numeroEtudiant: "" },
        {
          role: "etudiant",
          $or: [
            { numeroEtudiant: null },
            { numeroEtudiant: { $exists: false } },
          ],
        },
      ],
    });

    if (problemesRestants.length > 0) {
      console.warn(`\n${problemesRestants.length} problème(s) restant(s):`);
      problemesRestants.forEach((user) => {
        console.warn(
          `   - ${user.email} (${user.role}): ${user.numeroEtudiant}`
        );
      });
    } else {
      console.log(`\nAucun problème détecté après migration`);
    }
  } catch (error) {
    console.error("Erreur lors de la migration:", error);
  } finally {
    mongoose.connection.close();
  }
}

// Exécuter la migration
if (require.main === module) {
  migrerDonnees();
}

module.exports = migrerDonnees;
