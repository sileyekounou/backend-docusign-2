// scripts/debugWorkflow.js
const mongoose = require("mongoose");
require("dotenv").config();

const Document = require("../models/Document");
const Signature = require("../models/Signature");
const User = require("../models/User");

async function debugWorkflowEtSignatures() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log("🔍 === DEBUG WORKFLOW ET SIGNATURES ===\n");

    // 1. Vérifier tous les documents avec leur workflow
    console.log("📄 DOCUMENTS AVEC WORKFLOW:");
    const documents = await Document.find({})
      .populate("creeParUtilisateur", "nom prenom email")
      .populate("workflowSignature.utilisateur", "nom prenom email")
      .sort({ dateCreation: -1 })
      .limit(5);

    for (const doc of documents) {
      console.log(`\n📋 Document: "${doc.titre}"`);
      console.log(`   ID: ${doc._id}`);
      console.log(`   Statut: ${doc.statut}`);
      console.log(`   Créé par: ${doc.creeParUtilisateur?.nom} ${doc.creeParUtilisateur?.prenom}`);
      
      if (doc.workflowSignature && doc.workflowSignature.length > 0) {
        console.log(`   🔄 Workflow (${doc.workflowSignature.length} étapes):`);
        doc.workflowSignature.forEach((w, index) => {
          console.log(`      ${index + 1}. ${w.utilisateur?.nom} ${w.utilisateur?.prenom} (${w.utilisateur?.email})`);
          console.log(`         - Ordre: ${w.ordre}, Statut: ${w.statut}, Obligatoire: ${w.obligatoire}`);
        });
      } else {
        console.log(`   ❌ Aucun workflow défini !`);
      }

      // Vérifier les signatures correspondantes
      const signaturesDoc = await Signature.find({ document: doc._id })
        .populate("signataire", "nom prenom email");

      console.log(`   📝 Signatures trouvées: ${signaturesDoc.length}`);
      if (signaturesDoc.length > 0) {
        signaturesDoc.forEach((sig, index) => {
          console.log(`      ${index + 1}. ${sig.signataire?.nom} ${sig.signataire?.prenom}`);
          console.log(`         - Statut: ${sig.statut}, Ordre: ${sig.ordreSignature}`);
          console.log(`         - Créée: ${sig.dateCreation?.toISOString()}`);
        });
      } else {
        console.log(`   ❌ Aucune signature trouvée !`);
      }
    }

    // 2. Vérifier toutes les signatures
    console.log(`\n\n📝 === TOUTES LES SIGNATURES ===`);
    const toutesSignatures = await Signature.find({})
      .populate("document", "titre statut")
      .populate("signataire", "nom prenom email")
      .sort({ dateCreation: -1 })
      .limit(10);

    console.log(`Total signatures: ${toutesSignatures.length}`);
    toutesSignatures.forEach((sig, index) => {
      console.log(`\n${index + 1}. Signature ID: ${sig._id}`);
      console.log(`   Document: "${sig.document?.titre}"`);
      console.log(`   Signataire: ${sig.signataire?.nom} ${sig.signataire?.prenom}`);
      console.log(`   Statut: ${sig.statut}`);
      console.log(`   Ordre: ${sig.ordreSignature}`);
      console.log(`   Créée: ${sig.dateCreation}`);
    });

    // 3. Statistiques
    console.log(`\n\n📊 === STATISTIQUES ===`);
    
    const statsDocuments = await Document.aggregate([
      {
        $group: {
          _id: "$statut",
          count: { $sum: 1 }
        }
      }
    ]);
    
    const statsSignatures = await Signature.aggregate([
      {
        $group: {
          _id: "$statut",
          count: { $sum: 1 }
        }
      }
    ]);

    console.log("Documents par statut:");
    statsDocuments.forEach(stat => {
      console.log(`   ${stat._id}: ${stat.count}`);
    });

    console.log("Signatures par statut:");
    statsSignatures.forEach(stat => {
      console.log(`   ${stat._id}: ${stat.count}`);
    });

    // 4. Vérifier les utilisateurs
    console.log(`\n\n👥 === UTILISATEURS DISPONIBLES ===`);
    const utilisateurs = await User.find({}, "nom prenom email role").limit(10);
    console.log(`Total utilisateurs: ${utilisateurs.length}`);
    utilisateurs.forEach((user, index) => {
      console.log(`${index + 1}. ${user.nom} ${user.prenom} (${user.email}) - ${user.role}`);
    });

  } catch (error) {
    console.error("❌ Erreur:", error);
  } finally {
    mongoose.connection.close();
  }
}

debugWorkflowEtSignatures();