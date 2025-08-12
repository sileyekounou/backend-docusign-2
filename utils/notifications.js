const nodemailer = require("nodemailer");
const cron = require("node-cron");

class NotificationService {
  constructor() {
    // Configuration du transporteur email
    this.transporteur = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    // Vérifier la configuration email au démarrage
    this.verifierConfiguration();

    // Démarrer les tâches planifiées
    this.demarrerTachesPlanifiees();
  }

  /**
   * Vérifier la configuration du service email
   */
  async verifierConfiguration() {
    try {
      await this.transporteur.verify();
      console.log("✅ Service de notifications configuré correctement");
    } catch (error) {
      console.error("❌ Erreur configuration email:", error.message);
    }
  }

  /**
   * Envoyer un email générique
   */
  async envoyerEmail(options) {
    try {
      const { destinataire, sujet, texte, html, pieceJointe = null } = options;

      const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: destinataire,
        subject: sujet,
        text: texte,
        html: html || texte,
        ...(pieceJointe && { attachments: [pieceJointe] }),
      };

      const resultat = await this.transporteur.sendMail(mailOptions);

      console.log(`📧 Email envoyé à ${destinataire}: ${sujet}`);
      return {
        success: true,
        messageId: resultat.messageId,
      };
    } catch (error) {
      console.error("Erreur envoi email:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Notifier qu'un document a été envoyé pour signature
   */
  async notifierNouvelleSignature(document, signataire) {
    try {
      const sujet = `Nouvelle signature requise : ${document.titre}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Signature électronique requise</h2>
          
          <p>Bonjour <strong>${signataire.prenom} ${
        signataire.nom
      }</strong>,</p>
          
          <p>Un document nécessite votre signature électronique :</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #007bff;">${document.titre}</h3>
            <p><strong>Type:</strong> ${this.getTypeLibelle(document.type)}</p>
            <p><strong>Catégorie:</strong> ${this.getCategorieLibelle(
              document.categorie
            )}</p>
            ${
              document.description
                ? `<p><strong>Description:</strong> ${document.description}</p>`
                : ""
            }
            ${
              document.dateLimiteSignature
                ? `<p><strong>Date limite:</strong> ${new Date(
                    document.dateLimiteSignature
                  ).toLocaleDateString("fr-FR")}</p>`
                : ""
            }
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/signatures/${document._id}" 
               style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Signer le document
            </a>
          </div>
          
          <p style="color: #6c757d; font-size: 14px;">
            Cette signature est demandée par ${
              document.creeParUtilisateur.prenom
            } ${document.creeParUtilisateur.nom} (${
        document.creeParUtilisateur.email
      }).
          </p>
          
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
          <p style="color: #6c757d; font-size: 12px;">
            Plateforme de signature électronique - ${
              process.env.ORGANIZATION_NAME || "Votre organisation"
            }
          </p>
        </div>
      `;

      return await this.envoyerEmail({
        destinataire: signataire.email,
        sujet,
        html,
      });
    } catch (error) {
      console.error("Erreur notification nouvelle signature:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Notifier le prochain signataire dans le workflow
   */
  async notifierProchaineSignature(document, prochainSignataire) {
    try {
      await this.notifierNouvelleSignature(document, prochainSignataire);

      // Notification push/WebSocket si implémenté
      await this.envoyerNotificationTempsReel(prochainSignataire._id, {
        type: "nouvelle_signature",
        message: `Nouveau document à signer: ${document.titre}`,
        documentId: document._id,
      });
    } catch (error) {
      console.error("Erreur notification prochaine signature:", error);
    }
  }

  /**
   * Notifier qu'un document a été complètement signé
   */
  async notifierDocumentCompletementSigne(document) {
    try {
      // Notifier le créateur du document
      const sujet = `Document complètement signé : ${document.titre}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #28a745;">✅ Document complètement signé</h2>
          
          <p>Bonjour <strong>${document.creeParUtilisateur.prenom} ${
        document.creeParUtilisateur.nom
      }</strong>,</p>
          
          <p>Bonne nouvelle ! Le document suivant a été signé par tous les signataires requis :</p>
          
          <div style="background-color: #d4edda; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #28a745;">
            <h3 style="margin-top: 0; color: #155724;">${document.titre}</h3>
            <p><strong>Date de finalisation:</strong> ${new Date().toLocaleDateString(
              "fr-FR"
            )}</p>
            <p><strong>Nombre de signataires:</strong> ${
              document.workflowSignature.filter((w) => w.statut === "signe")
                .length
            }</p>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/documents/${document._id}" 
               style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; margin-right: 10px;">
              Voir le document
            </a>
            <a href="${process.env.FRONTEND_URL}/documents/${
        document._id
      }/download?version=signed" 
               style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Télécharger
            </a>
          </div>
          
          <p style="color: #6c757d; font-size: 14px;">
            Le document signé est maintenant disponible et archivé de manière sécurisée.
          </p>
        </div>
      `;

      await this.envoyerEmail({
        destinataire: document.creeParUtilisateur.email,
        sujet,
        html,
      });

      // Notifier tous les signataires
      for (const workflowItem of document.workflowSignature) {
        if (workflowItem.statut === "signe") {
          await this.notifierSignataireDocumentComplete(
            document,
            workflowItem.utilisateur
          );
        }
      }
    } catch (error) {
      console.error("Erreur notification document complet:", error);
    }
  }

  /**
   * Notifier un signataire que le document est complètement signé
   */
  async notifierSignataireDocumentComplete(document, signataire) {
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #28a745;">Document finalisé</h2>
          
          <p>Bonjour <strong>${signataire.prenom} ${signataire.nom}</strong>,</p>
          
          <p>Le document "<strong>${document.titre}</strong>" que vous avez signé est maintenant complètement finalisé.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/documents/${document._id}" 
               style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Consulter le document final
            </a>
          </div>
        </div>
      `;

      return await this.envoyerEmail({
        destinataire: signataire.email,
        sujet: `Document finalisé : ${document.titre}`,
        html,
      });
    } catch (error) {
      console.error("Erreur notification signataire document complet:", error);
    }
  }

  /**
   * Notifier qu'une signature a été rejetée
   */
  async notifierRejetSignature(document, signature, motifRejet) {
    try {
      const sujet = `Signature rejetée : ${document.titre}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc3545;">❌ Signature rejetée</h2>
          
          <p>Bonjour <strong>${document.creeParUtilisateur.prenom} ${
        document.creeParUtilisateur.nom
      }</strong>,</p>
          
          <p>Le document suivant a été rejeté par un signataire :</p>
          
          <div style="background-color: #f8d7da; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc3545;">
            <h3 style="margin-top: 0; color: #721c24;">${document.titre}</h3>
            <p><strong>Rejeté par:</strong> ${signature.signataire.prenom} ${
        signature.signataire.nom
      }</p>
            <p><strong>Motif:</strong> ${motifRejet}</p>
            ${
              signature.commentaireRejet
                ? `<p><strong>Commentaire:</strong> ${signature.commentaireRejet}</p>`
                : ""
            }
            <p><strong>Date de rejet:</strong> ${new Date().toLocaleDateString(
              "fr-FR"
            )}</p>
          </div>
          
          <p>Vous pouvez modifier le document ou contacter le signataire pour résoudre le problème.</p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/documents/${document._id}" 
               style="background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Voir le document
            </a>
          </div>
        </div>
      `;

      return await this.envoyerEmail({
        destinataire: document.creeParUtilisateur.email,
        sujet,
        html,
      });
    } catch (error) {
      console.error("Erreur notification rejet:", error);
    }
  }

  /**
   * Envoyer un rappel de signature
   */
  async envoyerRappelSignature(signature, messagePersonnalise = null) {
    try {
      const document = signature.document;
      const signataire = signature.signataire;

      const sujet = `Rappel : Signature requise pour ${document.titre}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ffc107;">⏰ Rappel de signature</h2>
          
          <p>Bonjour <strong>${signataire.prenom} ${
        signataire.nom
      }</strong>,</p>
          
          <p>Ceci est un rappel concernant le document suivant qui attend votre signature :</p>
          
          <div style="background-color: #fff3cd; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
            <h3 style="margin-top: 0; color: #856404;">${document.titre}</h3>
            ${
              document.dateLimiteSignature
                ? `<p><strong>⚠️ Date limite:</strong> ${new Date(
                    document.dateLimiteSignature
                  ).toLocaleDateString("fr-FR")}</p>`
                : ""
            }
          </div>
          
          ${
            messagePersonnalise
              ? `<div style="background-color: #e7f3ff; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p><strong>Message personnalisé :</strong></p>
              <p style="font-style: italic;">${messagePersonnalise}</p>
            </div>`
              : ""
          }
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/signatures/${signature._id}" 
               style="background-color: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Signer maintenant
            </a>
          </div>
          
          <p style="color: #6c757d; font-size: 14px;">
            Si vous avez des questions, contactez ${
              document.creeParUtilisateur.prenom
            } ${document.creeParUtilisateur.nom} (${
        document.creeParUtilisateur.email
      }).
          </p>
        </div>
      `;

      return await this.envoyerEmail({
        destinataire: signataire.email,
        sujet,
        html,
      });
    } catch (error) {
      console.error("Erreur rappel signature:", error);
    }
  }

  /**
   * Envoyer une notification temps réel (WebSocket/Push)
   */
  async envoyerNotificationTempsReel(utilisateurId, notification) {
    try {
      // Ici, implémenter la logique WebSocket ou push notifications
      // Par exemple avec Socket.IO

      console.log(
        `📱 Notification temps réel pour ${utilisateurId}:`,
        notification
      );

      // Exemple avec Socket.IO (à adapter selon votre implémentation)
      /*
      const io = require('../socket');
      io.to(`user_${utilisateurId}`).emit('notification', notification);
      */
    } catch (error) {
      console.error("Erreur notification temps réel:", error);
    }
  }

  /**
   * Démarrer les tâches planifiées pour les rappels automatiques
   */
  demarrerTachesPlanifiees() {
    // Rappels quotidiens à 9h pour les signatures en attente depuis plus de 2 jours
    cron.schedule("0 9 * * *", async () => {
      await this.envoyerRappelsAutomatiques();
    });

    // Nettoyage des signatures expirées tous les jours à minuit
    cron.schedule("0 0 * * *", async () => {
      await this.nettoyerSignaturesExpirees();
    });

    console.log("📅 Tâches planifiées démarrées");
  }

  /**
   * Envoyer des rappels automatiques
   */
  async envoyerRappelsAutomatiques() {
    try {
      const Signature = require("../models/Signature");

      // Trouver les signatures en attente depuis plus de 2 jours
      const il2Jours = new Date();
      il2Jours.setDate(il2Jours.getDate() - 2);

      const signaturesEnAttente = await Signature.find({
        statut: "en_attente",
        dateCreation: { $lte: il2Jours },
        rappelsEnvoyes: {
          $not: {
            $elemMatch: {
              date: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          },
        },
      })
        .populate("document", "titre dateLimiteSignature creeParUtilisateur")
        .populate("signataire", "nom prenom email")
        .populate("document.creeParUtilisateur", "nom prenom email");

      console.log(
        `📧 Envoi de ${signaturesEnAttente.length} rappels automatiques`
      );

      for (const signature of signaturesEnAttente) {
        await this.envoyerRappelSignature(
          signature,
          "Rappel automatique : votre signature est toujours en attente."
        );

        // Enregistrer le rappel
        signature.rappelsEnvoyes.push({
          date: new Date(),
          type: "email",
          destinataire: signature.signataire.email,
          statut: "envoye",
        });

        await signature.save();
      }
    } catch (error) {
      console.error("Erreur rappels automatiques:", error);
    }
  }

  /**
   * Nettoyer les signatures expirées
   */
  async nettoyerSignaturesExpirees() {
    try {
      const Signature = require("../models/Signature");

      const resultats = await Signature.nettoyerSignaturesExpirees();

      if (resultats.modifiedCount > 0) {
        console.log(
          `🧹 ${resultats.modifiedCount} signatures marquées comme expirées`
        );
      }
    } catch (error) {
      console.error("Erreur nettoyage signatures:", error);
    }
  }

  // Méthodes utilitaires
  getTypeLibelle(type) {
    const types = {
      note: "Note",
      pv: "Procès-verbal",
      attestation: "Attestation",
      convention: "Convention",
      releve_notes: "Relevé de notes",
      diplome: "Diplôme",
      autre: "Autre",
    };
    return types[type] || type;
  }

  getCategorieLibelle(categorie) {
    const categories = {
      pedagogique: "Pédagogique",
      administratif: "Administratif",
      stage: "Stage",
      evaluation: "Évaluation",
    };
    return categories[categorie] || categorie;
  }
}

module.exports = new NotificationService();
