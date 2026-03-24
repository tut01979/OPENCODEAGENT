import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { URL } from 'url';
import { exec } from 'child_process';

const CREDENTIALS_PATH = './gmail-credentials.json';
const TOKEN_PATH = './token.json';
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

const PORT = 3000;

async function authorize() {
  const credentialsContent = fs.readFileSync(path.resolve(CREDENTIALS_PATH), 'utf-8');
  const credentials = JSON.parse(credentialsContent);
  
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
  
  // Usar http://localhost:PORT como redirect
  const redirectUri = `http://localhost:${PORT}`;
  
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirectUri
  );

  // Verificar si ya tenemos token guardado
  if (fs.existsSync(TOKEN_PATH)) {
    const tokenContent = fs.readFileSync(TOKEN_PATH, 'utf-8');
    oAuth2Client.setCredentials(JSON.parse(tokenContent));
    console.log('✅ Token existente encontrado');
    console.log('Si quieres renovar el token, elimina token.json y ejecuta este script de nuevo');
    return;
  }

  // Crear servidor local para recibir el callback
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '', `http://localhost:${PORT}`);
    const code = url.searchParams.get('code');
    
    if (code) {
      try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        
        // Guardar token
        fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html>
            <body style="font-family: Arial; text-align: center; padding: 50px;">
              <h1>✅ Autorización completada</h1>
              <p>Puedes cerrar esta ventana y volver a la terminal.</p>
            </body>
          </html>
        `);
        
        console.log('\n✅ Token guardado correctamente en token.json');
        console.log('✅ Ya puedes usar Gmail, Calendar, Drive y Sheets\n');
        
        setTimeout(() => {
          server.close();
          process.exit(0);
        }, 1000);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>Error</h1><p>No se pudo obtener el token.</p>');
        console.error('Error obteniendo token:', error);
      }
    } else {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>Error</h1><p>No se recibió código de autorización.</p>');
    }
  });

  server.listen(PORT, () => {
    // Generar URL de autorización
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
      redirect_uri: redirectUri,
    });

    console.log(`\n🔐 Abriendo navegador para autorización...`);
    console.log(`Si no se abre automáticamente, copia este enlace:\n`);
    console.log(authUrl);
    console.log('\nEsperando autorización en http://localhost:3000 ...\n');
    
    // Intentar abrir el navegador automáticamente
    exec(`start "" "${authUrl}"`);
  });
}

authorize();
