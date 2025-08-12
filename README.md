# Plateforme de Signature Électronique - Backend

Une plateforme complète de gestion de signatures électroniques développée avec Node.js, Express, MongoDB et l'intégration Dropbox Sign.

## Fonctionnalités

### Gestion des utilisateurs

- **Authentification sécurisée** avec JWT
- **Système de rôles** : Administrateur, Enseignant, Responsable pédagogique, Étudiant
- **Profils utilisateurs** complets avec informations pédagogiques
- **Réinitialisation de mot de passe** sécurisée
- **Vérification d'email** obligatoire

### Gestion des documents

- **Upload de documents** (PDF, DOC, DOCX) avec validation
- **Métadonnées pédagogiques** (matière, semestre, promotion, etc.)
- **Catégorisation** (pédagogique, administratif, stage, évaluation)
- **Niveaux de confidentialité** (public, restreint, confidentiel)
- **Historique complet** des modifications et actions
- **Recherche avancée** avec filtres multiples

### Workflow de signature

- **Signature électronique** via Dropbox Sign
- **Workflow personnalisable** avec ordre de signature
- **Signature intégrée** dans l'interface web
- **Géolocalisation** et métadonnées de signature
- **Gestion des rejets** avec motifs et commentaires
- **Rappels automatiques** pour les signatures en attente

### Notifications et communication

- **Notifications email** automatiques
- **Rappels personnalisés** pour les signataires
- **Notifications temps réel** (WebSocket ready)
- **Tâches planifiées** pour la maintenance

### Sécurité et audit

- **Chiffrement des mots de passe** avec bcrypt
- **Rate limiting** pour prévenir les abus
- **Validation stricte** des données d'entrée
- **Journalisation complète** des actions sensibles
- **Vérification d'intégrité** des fichiers (hash SHA-256)

## Technologies utilisées

- **Runtime** : Node.js
- **Framework** : Express.js
- **Base de données** : MongoDB avec Mongoose ODM
- **Authentification** : JWT (JSON Web Tokens)
- **Signature électronique** : Dropbox Sign API
- **Upload de fichiers** : Multer
- **Validation** : express-validator
- **Email** : Nodemailer
- **Sécurité** : Helmet, CORS, bcryptjs
- **Tâches planifiées** : node-cron

## Prérequis

- Node.js >= 16.0.0
- MongoDB >= 5.0
- Un compte Dropbox Sign (HelloSign)
- Un serveur SMTP pour les emails

## Installation

1. **Cloner le repository**

```bash
git clone <repository-url>
cd signature-platform-backend
```

2. **Installer les dépendances**

```bash
npm install
```

3. **Configuration des variables d'environnement**

Créer un fichier `.env` à la racine du projet :

```env
# Configuration générale
NODE_ENV=development
PORT=5000
FRONTEND_URL=http://localhost:3000

# Base de données
MONGODB_URI=mongodb://localhost:27017/signature-platform

# JWT
JWT_SECRET=votre_secret_jwt_tres_long_et_securise
JWT_EXPIRES_IN=24h

# Dropbox Sign
DROPBOX_SIGN_API_KEY=votre_cle_api_dropbox_sign
DROPBOX_SIGN_CLIENT_ID=votre_client_id_dropbox_sign
DROPBOX_SIGN_WEBHOOK_SECRET=votre_secret_webhook

# Configuration SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre_email@gmail.com
SMTP_PASS=votre_mot_de_passe_app
EMAIL_FROM=votre_email@gmail.com

# Organisation
ORGANIZATION_NAME=Votre Organisation
```

4. **Démarrer le serveur**

```bash
# Mode développement
npm run dev

# Mode production
npm start
```

## Structure du projet

```
src/
├── controllers/           # Contrôleurs (logique métier)
│   ├── authController.js
│   ├── documentController.js
│   └── signatureController.js
├── middleware/           # Middlewares personnalisés
│   ├── auth.js          # Authentification JWT
│   └── roleAuth.js      # Gestion des rôles
├── models/              # Modèles Mongoose
│   ├── User.js
│   ├── Document.js
│   └── Signature.js
├── routes/              # Routes API
│   ├── auth.js
│   ├── documents.js
│   ├── signatures.js
│   └── users.js
├── services/            # Services externes
│   └── dropboxSignService.js
├── utils/               # Utilitaires
│   └── notifications.js
├── uploads/             # Fichiers uploadés
│   ├── documents/
│   └── signed/
└── server.js           # Point d'entrée
```

## API Endpoints

### Authentification (`/api/auth`)

- `POST /inscription` - Inscription d'un utilisateur
- `POST /connexion` - Connexion
- `GET /profil` - Profil utilisateur
- `PUT /profil` - Mise à jour du profil
- `POST /changer-mot-de-passe` - Changement de mot de passe
- `POST /mot-de-passe/demande-reset` - Demande de réinitialisation
- `POST /mot-de-passe/reset` - Réinitialisation avec token
- `GET /verify-email/:token` - Vérification d'email

### Documents (`/api/documents`)

- `POST /` - Créer un document
- `GET /` - Liste des documents (avec pagination et filtres)
- `GET /:id` - Détails d'un document
- `PUT /:id` - Mettre à jour un document
- `DELETE /:id` - Supprimer un document
- `POST /:id/envoyer-signature` - Envoyer pour signature
- `GET /:id/telecharger` - Télécharger un document
- `GET /stats/global` - Statistiques des documents

### Signatures (`/api/signatures`)

- `GET /en-attente` - Signatures en attente
- `GET /:id` - Détails d'une signature
- `POST /:id/signer` - Signer un document
- `POST /:id/rejeter` - Rejeter une signature
- `GET /:id/url-signature` - URL de signature intégrée
- `POST /:id/rappel` - Envoyer un rappel
- `POST /webhook/dropbox-sign` - Webhook Dropbox Sign

### Utilisateurs (`/api/users`)

- `GET /` - Liste des utilisateurs
- `POST /` - Créer un utilisateur
- `GET /:id` - Détails d'un utilisateur
- `PUT /:id` - Mettre à jour un utilisateur
- `DELETE /:id` - Supprimer un utilisateur
- `POST /:id/reset-password` - Réinitialiser le mot de passe

## Système de rôles

### Administrateur

- Accès complet à toutes les fonctionnalités
- Gestion des utilisateurs
- Accès aux statistiques globales
- Configuration du système

### Responsable pédagogique

- Gestion des documents pédagogiques
- Supervision des signatures
- Statistiques de son établissement
- Création d'utilisateurs dans son périmètre

### Enseignant

- Création et gestion de ses documents
- Envoi pour signature
- Suivi des workflows de signature

### Étudiant

- Consultation des documents le concernant
- Signature des documents requis
- Historique de ses signatures

## Sécurité

### Authentification

- Tokens JWT avec expiration
- Refresh tokens pour les sessions longues
- Limitation des tentatives de connexion
- Blocage temporaire des comptes

### Validation des données

- Validation stricte avec express-validator
- Sanitisation des entrées utilisateur
- Vérification des types de fichiers
- Limitation de la taille des uploads

### Protection

- Rate limiting par IP et par utilisateur
- Headers de sécurité avec Helmet
- CORS configuré précisément
- Chiffrement des mots de passe avec bcrypt

## Configuration des emails

Le système utilise Nodemailer pour l'envoi d'emails. Configurez votre serveur SMTP dans les variables d'environnement.

### Exemples de configuration

**Gmail :**

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre_email@gmail.com
SMTP_PASS=votre_mot_de_passe_app
```

**Outlook :**

```env
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=votre_email@outlook.com
SMTP_PASS=votre_mot_de_passe
```

## Configuration Dropbox Sign

1. Créez un compte sur [Dropbox Sign](https://www.dropboxsign.com/)
2. Obtenez votre clé API dans les paramètres du compte
3. Configurez les webhooks pour recevoir les événements de signature
4. Ajoutez les variables d'environnement correspondantes

## Tests

```bash
# Lancer tous les tests
npm test

# Tests avec couverture
npm run test:coverage

# Tests en mode watch
npm run test:watch
```

## Monitoring et logs

### Logs d'audit

- Toutes les actions sensibles sont journalisées
- Format JSON pour faciliter l'analyse
- Rotation automatique des logs en production

### Métriques

- Nombre de documents créés/signés
- Temps moyen de signature
- Statistiques par utilisateur/établissement
- Taux de rejet des signatures

## Déploiement

### Environnement de production

1. **Variables d'environnement**

```bash
NODE_ENV=production
PORT=5000
# ... autres variables
```

2. **Serveur web**
   Utilisez un proxy inverse comme Nginx :

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

3. **Process manager**
   Utilisez PM2 pour la gestion des processus :

```bash
npm install -g pm2
pm2 start server.js --name signature-backend
pm2 startup
pm2 save
```

### Docker

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 5000

CMD ["npm", "start"]
```

## Contribution

1. Fork le projet
2. Créez une branche feature (`git checkout -b feature/AmazingFeature`)
3. Committez vos changements (`git commit -m 'Add some AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrez une Pull Request

## License

Ce projet est sous licence MIT. Voir le fichier `LICENSE` pour plus de détails.

## Support

Pour toute question ou problème :

- Créez une issue sur GitHub
- Consultez la documentation de l'API
- Contactez l'équipe de développement

## Roadmap

- [ ] Interface d'administration web
- [ ] API REST complète avec documentation OpenAPI
- [ ] Intégration avec d'autres services de signature
- [ ] Application mobile
- [ ] Analyses avancées et reporting
- [ ] Intégration SSO (SAML, OAuth2)
- [ ] Support multilingue
- [ ] API GraphQL

---

**Développé avec ❤️ pour simplifier la gestion des signatures électroniques dans l'enseignement supérieur.**
