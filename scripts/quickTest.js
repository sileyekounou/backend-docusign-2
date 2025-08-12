
// test-email-ssl.js
const nodemailer = require('nodemailer');
require('dotenv').config();

async function testMultipleConfigurations() {
  console.log('Test de configurations SMTP multiples...\n');

  const configurations = [
    {
      name: "Gmail STARTTLS (Port 587)",
      config: {
        host: "smtp.gmail.com",
        port: 587,
        secure: false, // STARTTLS
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: {
          rejectUnauthorized: false, // Accepter les certificats auto-signés
          minVersion: "TLSv1.2", // Version TLS minimum
          ciphers: "SSLv3", // Compatibilité étendue
        },
        // Options de connexion
        connectionTimeout: 60000, // 60 secondes timeout
        greetingTimeout: 30000, // 30 secondes pour le greeting
        socketTimeout: 75000, // 75 secondes socket timeout
        // Debug (à retirer en production)
        debug: process.env.NODE_ENV === "development",
        logger: process.env.NODE_ENV === "development",
      },
    },
    {
      name: "Gmail SSL/TLS (Port 465)",
      config: {
        host: "smtp.gmail.com",
        port: 465,
        secure: true, // SSL/TLS
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        tls: {
    rejectUnauthorized: false, // Accepter les certificats auto-signés
    minVersion: 'TLSv1.2',      // Version TLS minimum
    ciphers: 'SSLv3'            // Compatibilité étendue
  },
  // Options de connexion
  connectionTimeout: 60000,     // 60 secondes timeout
  greetingTimeout: 30000,       // 30 secondes pour le greeting
  socketTimeout: 75000,         // 75 secondes socket timeout
  // Debug (à retirer en production)
  debug: process.env.NODE_ENV === 'development',
  logger: process.env.NODE_ENV === 'development'
      },
    },
  ];

  for (const { name, config } of configurations) {
    console.log(`Test de configuration : ${name}`);
    console.log(`   Host: ${config.host}:${config.port}`);
    console.log(`   Sécurisé: ${config.secure ? 'SSL/TLS direct' : 'STARTTLS'}`);
    
    try {
      const transporter = nodemailer.createTransport(config);
      
      // Test de connexion
      await transporter.verify();
      console.log('Connexion réussie !');
      
      // Test d'envoi d'email
      const info = await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to: process.env.SMTP_USER,
        subject: `Test ${name} - ${new Date().toLocaleTimeString()}`,
        text: `Configuration ${name} fonctionne !`,
        html: `
          <h3>Configuration ${name} validée</h3>
          <p>Port: ${config.port}, Sécurisé: ${config.secure}</p>
          <p>Heure: ${new Date().toISOString()}</p>
        `
      });
      
      console.log(`Email envoyé ! ID: ${info.messageId}`);
      console.log(`Configuration ${name} OPÉRATIONNELLE\n`);
      
      // Si cette config marche, on s'arrête là
      console.log('Configuration recommandée pour votre .env :');
      console.log(`SMTP_HOST=${config.host}`);
      console.log(`SMTP_PORT=${config.port}`);
      console.log(`SMTP_SECURE=${config.secure}`);
      console.log(`SMTP_USER=${process.env.SMTP_USER}`);
      console.log(`SMTP_PASS=votre-mot-de-passe-app`);
      console.log(`EMAIL_FROM=${process.env.EMAIL_FROM}`);
      break;
      
    } catch (error) {
      console.log('Échec de cette configuration');
      console.log(`   Erreur: ${error.message}`);
      
      // Diagnostic spécifique
      if (error.code === 'ESOCKET' && error.message.includes('wrong version number')) {
        console.log('   Diagnostic: Incompatibilité SSL/Port');
      } else if (error.code === 'EAUTH') {
        console.log('   Diagnostic: Problème d\'authentification');
      } else if (error.code === 'ECONNECTION') {
        console.log('   Diagnostic: Problème de connexion réseau');
      }
      console.log('');
    }
  }
}

// Vérifications préliminaires
console.log('Vérifications préliminaires:');
if (!process.env.SMTP_USER) {
  console.log('SMTP_USER non défini');
  process.exit(1);
}
if (!process.env.SMTP_PASS) {
  console.log('SMTP_PASS non défini');
  process.exit(1);
}
if (process.env.SMTP_PASS.length < 16) {
  console.log('SMTP_PASS semble trop court (devrait faire 16 caractères pour Gmail)');
}

console.log(`SMTP_USER: ${process.env.SMTP_USER}`);
console.log(`SMTP_PASS: ***${process.env.SMTP_PASS.slice(-4)} (${process.env.SMTP_PASS.length} caractères)`);
console.log('');

testMultipleConfigurations();
