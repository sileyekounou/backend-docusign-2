// scripts/repareSignatures.js
const mongoose = require("mongoose");
require("dotenv").config();

const Document = require("../models/Document");
const Signature = require("../models/Signature");

async function repareSignaturesManquantes() {
  try {
    console.log("🔧 Début de la réparation des signatures manquantes...");

    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    // Trouver tous les documents avec workflow mais sans signatures
    const documentsAvecWorkflow = await Document.find({
      workflowSignature: { $exists: true, $not: { $size: 0 } },
      statut: { $in: ["en_attente_signature", "partiellement_signe", "signe"] }
    }).populate("workflowSignature.utilisateur creeParUtilisateur");

    console.log(`📄 Trouvé ${documentsAvecWorkflow.length} documents avec workflow`);

    let documentsRepares = 0;
    let signaturesCreees = 0;

    for (const document of documentsAvecWorkflow) {
      console.log(`\n🔍 Vérification document: ${document.titre}`);

      // Vérifier les incohérences
      const incohérences = await document.verifierCoherenceSignatures();
      
      if (incohérences.length > 0) {
        console.log(`   ⚠️  ${incohérences.length} incohérence(s) détectée(s)`);

        // Créer les signatures manquantes
        const signaturesManquantes = incohérences.filter(i => i.type === "signature_manquante");
        
        for (const manquante of signaturesManquantes) {
          const nouvelleSignature = new Signature({
            document: document._id,
            signataire: manquante.utilisateur,
            statut: "en_attente",
            ordreSignature: manquante.ordre,
            creeParUtilisateur: document.creeParUtilisateur._id,
            dateExpiration: document.dateLimiteSignature || null,
            
            // Si le document a des données Dropbox Sign, les ajouter
            ...(document.dropboxSign?.signatureRequestId && {
              dropboxSign: {
                signatureRequestId: document.dropboxSign.signatureRequestId,
                statusCode: "awaiting_signature",
              }
            }),
          });

          nouvelleSignature.ajouterHistorique(
            "creation",
            document.creeParUtilisateur._id,
            "Signature créée lors de la réparation automatique"
          );

          await nouvelleSignature.save();
          signaturesCreees++;
          
          console.log(`   ✅ Signature créée pour utilisateur ${manquante.utilisateur}`);
        }

        // Supprimer les signatures orphelines
        const signaturesOrphelines = incohérences.filter(i => i.type === "signature_orpheline");
        for (const orpheline of signaturesOrphelines) {
          await Signature.findByIdAndDelete(orpheline.signatureId);
          console.log(`   🗑️  Signature orpheline supprimée: ${orpheline.signatureId}`);
        }

        documentsRepares++;
      } else {
        console.log("   ✅ Document cohérent");
      }

      // Synchroniser les statuts
      await document.synchroniserStatutsSignatures();
    }

    console.log(`\n🎉 Réparation terminée !`);
    console.log(`📊 Résumé :`);
    console.log(`   - Documents vérifiés: ${documentsAvecWorkflow.length}`);
    console.log(`   - Documents réparés: ${documentsRepares}`);
    console.log(`   - Signatures créées: ${signaturesCreees}`);

    // Vérification finale
    console.log(`\n🔍 Vérification finale...`);
    
    const documentsAvecSignatures = await Document.aggregate([
      { $match: { workflowSignature: { $exists: true, $not: { $size: 0 } } } },
      {
        $lookup: {
          from: "signatures",
          localField: "_id",
          foreignField: "document",
          as: "signatures"
        }
      },
      {
        $addFields: {
          workflowCount: { $size: "$workflowSignature" },
          signaturesCount: { $size: "$signatures" }
        }
      },
      {
        $match: {
          $expr: { $ne: ["$workflowCount", "$signaturesCount"] }
        }
      }
    ]);

    if (documentsAvecSignatures.length === 0) {
      console.log("   ✅ Tous les documents sont maintenant cohérents !");
    } else {
      console.log(`   ⚠️  ${documentsAvecSignatures.length} documents ont encore des incohérences`);
      documentsAvecSignatures.forEach(doc => {
        console.log(`      - ${doc.titre}: ${doc.workflowCount} workflow, ${doc.signaturesCount} signatures`);
      });
    }

  } catch (error) {
    console.error("❌ Erreur lors de la réparation:", error);
  } finally {
    mongoose.connection.close();
  }
}

// Exécuter le script
if (require.main === module) {
  repareSignaturesManquantes();
}

module.exports = repareSignaturesManquantes;