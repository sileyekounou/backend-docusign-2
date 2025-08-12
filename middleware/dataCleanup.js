// middleware/dataCleanup.js
/**
 * Middleware pour nettoyer les données d'entrée
 * Convertit les chaînes vides en null pour les champs optionnels
 */
exports.nettoyerDonnees = (req, res, next) => {
  if (req.body && typeof req.body === "object") {
    // Champs qui doivent être null s'ils sont vides
    const champsOptionnels = [
      "numeroEtudiant",
      "promotion",
      "departement",
      "specialite",
      "telephone",
      "etablissement",
    ];

    champsOptionnels.forEach((champ) => {
      if (req.body[champ] === "" || req.body[champ] === undefined) {
        req.body[champ] = null;
      }
    });

    // Cas spécial : établissement requis pour non-étudiants
    if (req.body.role && req.body.role !== "etudiant") {
      if (!req.body.etablissement || req.body.etablissement === "") {
        req.body.etablissement = null; // Sera validé par le validateur
      }
    }
  }

  next();
};

// Middleware pour la logique métier des rôles
exports.validerLogiqueMétier = (req, res, next) => {
  if (req.body.role) {
    switch (req.body.role) {
      case "etudiant":
        // Nettoyer les champs non-étudiants
        req.body.etablissement = req.body.etablissement || null;
        break;

      case "administrateur":
      case "enseignant":
      case "responsable_pedagogique":
        // Nettoyer les champs étudiants
        req.body.numeroEtudiant = null;
        req.body.promotion = null;
        break;
    }
  }

  next();
};
