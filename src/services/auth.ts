import { google } from 'googleapis';
import { firebase } from './firebase.js';
import express from 'express';
import fs from 'fs';
import path from 'path';

// Configuración de credenciales de Google
let CREDENTIALS_PATH = './credentials/gmail-credentials.json';

// Fallback al antiguo directorio data por retrocompatibilidad
if (!fs.existsSync(CREDENTIALS_PATH)) {
  CREDENTIALS_PATH = './data/gmail-credentials.json';
}

export function getOAuth2Client() {
  let credentials;
  
  // NATIVO CLOUD: Priorizar variable de entorno con el JSON puro antes que archivos
  if (process.env.GMAIL_CREDENTIALS_JSON) {
    console.log("🔑 Usando GMAIL_CREDENTIALS_JSON desde variables de entorno");
    credentials = JSON.parse(process.env.GMAIL_CREDENTIALS_JSON);
  } else {
    // FALLBACK LOCAL: Si no hay variable, leemos archivo físico
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      console.error(`❌ Falta ${CREDENTIALS_PATH} o la variable GMAIL_CREDENTIALS_JSON. Configúralos primero.`);
      return null;
    }
    credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  }
  
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  
  // DETECCIÓN DINÁMICA DE REDIRECT URI
  let redirectUri = redirect_uris[0];
  
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    redirectUri = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}/auth/google/callback`;
  } else if (process.env.NODE_ENV === 'production') {
    redirectUri = 'https://opencodeagent-production.up.railway.app/auth/google/callback';
  }

  return new google.auth.OAuth2(client_id, client_secret, redirectUri);
}

/**
 * Obtiene el token maestro del administrador si está configurado en env
 */
export function getMasterToken() {
  if (process.env.GMAIL_TOKEN_JSON) {
    try {
      return JSON.parse(process.env.GMAIL_TOKEN_JSON);
    } catch {
      return null;
    }
  }
  return null;
}

export function generateAuthUrl(userId: string) {
  const oAuth2Client = getOAuth2Client();
  if (!oAuth2Client) return null;

  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // Forzamos refresh_token para que no caduque su acceso nunca
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/spreadsheets'
    ],
    state: userId // EL TRUCO: Pasamos el ID de Telegram para saber de quién es este token al volver
  });
}

// Servidor Express para el Callback
export function startAuthServer(port: number = 3000) {
  const app = express();

  app.get('/auth/google/callback', async (req, res) => {
    const code = req.query.code as string;
    const userId = req.query.state as string;

    if (!code || !userId) {
      return res.status(400).send('❌ Falta código o usuario.');
    }

    const oAuth2Client = getOAuth2Client();
    if (!oAuth2Client) return res.status(500).send('❌ Error de configuración.');

    try {
      const { tokens } = await oAuth2Client.getToken(code);
      await firebase.saveUserToken(userId, tokens);
      
      res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
          <h1 style="color: #4CAF50;">✅ ¡Conexión Exitosa!</h1>
          <p>Tu OpenCodeAgent ya tiene acceso a tus herramientas de Google.</p>
          <p><strong>Ya puedes cerrar esta ventana y volver a Telegram.</strong></p>
        </div>
      `);
      console.log(`📡 Cliente conectado con éxito: ${userId}`);
    } catch (error) {
      console.error('Error intercambiando el código de Google:', error);
      res.status(500).send('❌ Error al autenticar con Google.');
    }
  });

  app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>OpenCodeAgent | Tu Ejecutivo IA Híbrido</title>
          <style>
              :root {
                  --primary: #8A2BE2;
                  --secondary: #00D2FF;
                  --dark: #0F0F1B;
                  --glass: rgba(255, 255, 255, 0.05);
              }
              body {
                  margin: 0;
                  font-family: 'Inter', sans-serif;
                  background: var(--dark);
                  color: white;
                  overflow-x: hidden;
              }
              .background {
                  position: fixed;
                  top: 0; left: 0; width: 100%; height: 100%;
                  z-index: -1;
                  background: radial-gradient(circle at 20% 30%, #1a1a3a 0%, #0f0f1b 100%);
              }
              .glow {
                  position: absolute;
                  width: 600px; height: 600px;
                  background: radial-gradient(circle, rgba(138, 43, 226, 0.15) 0%, transparent 70%);
                  top: -200px; right: -100px;
                  filter: blur(100px);
              }
              nav {
                  padding: 20px 50px;
                  display: flex; justify-content: space-between; align-items: center;
                  backdrop-filter: blur(10px);
                  border-bottom: 1px solid var(--glass);
              }
              .logo { font-weight: 800; font-size: 24px; letter-spacing: -1px; background: linear-gradient(90deg, var(--primary), var(--secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
              .hero {
                  height: 80vh;
                  display: flex; flex-direction: column; justify-content: center; align-items: center;
                  text-align: center; padding: 0 20px;
              }
              h1 { font-size: 72px; margin-bottom: 10px; letter-spacing: -2px; }
              p { font-size: 20px; color: #a0a0c0; max-width: 600px; line-height: 1.6; }
              .cta {
                  margin-top: 40px;
                  padding: 18px 40px;
                  font-size: 18px; font-weight: 600;
                  background: linear-gradient(90deg, var(--primary), var(--secondary));
                  border: none; border-radius: 50px;
                  color: white; cursor: pointer; text-decoration: none;
                  transition: transform 0.3s ease, box-shadow 0.3s ease;
                  box-shadow: 0 10px 30px rgba(138, 43, 226, 0.3);
              }
              .cta:hover { transform: translateY(-5px); box-shadow: 0 15px 40px rgba(138, 43, 226, 0.5); }
              .features {
                  display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                  gap: 30px; padding: 50px; max-width: 1200px; margin: 0 auto;
              }
              .card {
                  background: var(--glass);
                  border: 1px solid rgba(255, 255, 255, 0.1);
                  padding: 40px; border-radius: 24px;
                  backdrop-filter: blur(20px);
                  transition: border 0.3s ease;
              }
              .card:hover { border-color: var(--primary); }
              .card h3 { color: var(--secondary); margin-top: 0; }
              footer { text-align: center; padding: 50px; color: #555; border-top: 1px solid var(--glass); }
          </style>
      </head>
      <body>
          <div class="background">
              <div class="glow"></div>
          </div>
          <nav>
              <div class="logo">OPENCODEAGENT</div>
              <div>v1.4 Production</div>
          </nav>
          <section class="hero">
              <h1>Tu Ejecutivo IA Híbrido</h1>
              <p>Controla Gmail, Calendar y Drive con la potencia de la Inteligencia Artificial directamente desde Telegram. Multi-usuario, seguro y ultrarrápido.</p>
              <a href="https://t.me/${process.env.TELEGRAM_BOT_USERNAME || 'OPENCODE_AGENT_BOT'}" class="cta">Empezar Prueba Gratis 7 Días</a>
          </section>
          <div class="features">
              <div class="card">
                  <h3>📧 Gestión de Email</h3>
                  <p>Resume hilos complejos, envía respuestas ejecutivas y mantén tu bandeja de entrada vacía con comandos de voz.</p>
              </div>
              <div class="card">
                  <h3>📅 Agenda Inteligente</h3>
                  <p>Consulta tus eventos, crea reuniones y sincroniza tu vida laboral sin salir de Telegram.</p>
              </div>
              <div class="card">
                  <h3>🧠 Visión Híbrida</h3>
                  <p>Envía capturas de pantalla o documentos y deja que OpenCode los analice, resuma o extraiga datos automáticamente.</p>
              </div>
          </div>
          <footer>
              &copy; 2026 OpenCodeAgent SaaS Hub. Built for Jesús Quintero Martínez.
          </footer>
      </body>
      </html>
    `);
  });

  app.listen(port, () => {
    console.log(`🌐 Servidor de autenticación y landing page listo en el puerto ${port}`);
  });
}
