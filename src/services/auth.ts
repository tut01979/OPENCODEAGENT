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

  app.listen(port, () => {
    console.log(`🌐 Servidor de autenticación listo en el puerto ${port}`);
  });
}
