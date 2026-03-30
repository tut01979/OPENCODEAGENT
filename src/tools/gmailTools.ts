import { google } from 'googleapis';
import fs from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import type { Tool } from './types.js';

import { firebase } from '../services/firebase.js';
import { generateAuthUrl, getOAuth2Client as getClientBase } from '../services/auth.js';

async function getGmailClient(userId: string) {
  try {
    const oAuth2Client = getClientBase();
    if (!oAuth2Client) return null;

    // 1. Intentar obtener token de Firebase para este usuario específico
    const userToken = await firebase.getUserToken(userId);
    
    if (userToken) {
      oAuth2Client.setCredentials(userToken);
      return google.gmail({ version: 'v1', auth: oAuth2Client });
    }

    // 2. FALLBACK: Si no hay token de usuario, intentar cargar el token por defecto (solo para admins o si existe)
    try {
      const TOKEN_PATH = './data/token.json';
      if (fs_sync.existsSync(TOKEN_PATH)) {
        const tokenContent = await fs.readFile(path.resolve(TOKEN_PATH), 'utf-8');
        oAuth2Client.setCredentials(JSON.parse(tokenContent));
        return google.gmail({ version: 'v1', auth: oAuth2Client });
      }
    } catch {
      // Ignorar fallback si falla
    }

    return null;
  } catch {
    return null;
  }
}

const AUTH_ERROR_MSG = (userId: string) => {
  const url = generateAuthUrl(userId);
  return `⚠️ No estás conectado con Google. Para usar esta herramienta, por favor autoriza el acceso aquí:\n\n🔗 ${url}\n\nUna vez hecho, vuelve a intentarlo.`;
};

export const readEmailTool: Tool = {
  name: 'read_email',
  description: 'Lista los últimos emails de Gmail (solo metadatos: De, Asunto, Fecha).',
  parameters: {
    type: 'object',
    properties: {
      max_results: { type: 'number', description: 'Número máximo (default: 5)' },
      query: { type: 'string', description: 'Filtro (ej: "is:unread")' },
    },
  },
  execute: async (params, userId) => {
    const maxResults = (params.max_results as number) || 5;
    const query = (params.query as string) || '';
    const gmail = await getGmailClient(userId);
    if (!gmail) return AUTH_ERROR_MSG(userId);

    try {
      const response = await gmail.users.messages.list({ userId: 'me', maxResults, q: query });
      const messages = response.data.messages || [];
      if (messages.length === 0) return 'No se encontraron emails';

      const results = [];
      for (const m of messages) {
        const msg = await gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] });
        const headers = msg.data.payload?.headers || [];
        const from = headers.find(h => h.name === 'From')?.value || '?';
        const subj = headers.find(h => h.name === 'Subject')?.value || '?';
        results.push(`ID: ${m.id}\nDe: ${from}\nAsunto: ${subj}`);
      }
      return `Emails encontrados:\n\n${results.join('\n\n')}`;
    } catch (err) { return `Error: ${err}`; }
  },
};

export const getEmailDetailsTool: Tool = {
  name: 'get_email_details',
  description: 'Lee el cuerpo completo de un email específico por su ID.',
  parameters: {
    type: 'object',
    properties: {
      message_id: { type: 'string', description: 'ID del mensaje obtenido con read_email' },
    },
    required: ['message_id'],
  },
  execute: async (params, userId) => {
    const id = params.message_id as string;
    const gmail = await getGmailClient(userId);
    if (!gmail) return AUTH_ERROR_MSG(userId);

    try {
      const msg = await gmail.users.messages.get({ userId: 'me', id });
      const payload = msg.data.payload;
      let body = '';

      if (payload?.parts) {
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain') || payload.parts[0];
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      } else if (payload?.body?.data) {
        body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }

      const attachments = payload?.parts?.filter(p => p.filename && p.body?.attachmentId).map(p => `- ${p.filename} (ID Adjunto: ${p.body?.attachmentId})`) || [];

      return `📧 Cuerpo del mensaje:\n\n${body}\n\nAdjuntos:\n${attachments.length ? attachments.join('\n') : 'Ninguno'}`;
    } catch (err) { return `Error: ${err}`; }
  },
};

export const downloadAttachmentTool: Tool = {
  name: 'download_gmail_attachment',
  description: 'Descarga un archivo adjunto de un email.',
  parameters: {
    type: 'object',
    properties: {
      message_id: { type: 'string', description: 'ID del mensaje' },
      attachment_id: { type: 'string', description: 'ID del adjunto' },
      filename: { type: 'string', description: 'Nombre para guardar el archivo localmente' },
    },
    required: ['message_id', 'attachment_id', 'filename'],
  },
  execute: async (params, userId) => {
    const { message_id, attachment_id, filename } = params as any;
    const gmail = await getGmailClient(userId);
    if (!gmail) return AUTH_ERROR_MSG(userId);

    try {
      const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId: message_id, id: attachment_id });
      const data = Buffer.from(res.data.data!, 'base64');
      const uploadDir = './uploads';
      if (!fs_sync.existsSync(uploadDir)) fs_sync.mkdirSync(uploadDir);
      const filePath = path.join(uploadDir, filename);
      await fs.writeFile(filePath, data);
      return `✅ Adjunto guardado en: ${filePath}`;
    } catch (err) { return `Error: ${err}`; }
  },
};

export const sendEmailTool: Tool = {
  name: 'send_email',
  description: 'Envía un email usando Gmail. Requiere configuración OAuth2.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Destinatario' },
      subject: { type: 'string', description: 'Asunto' },
      body: { type: 'string', description: 'Cuerpo' },
    },
    required: ['to', 'subject', 'body'],
  },
  execute: async (params, userId) => {
    const { to, subject, body } = params as any;
    const gmail = await getGmailClient(userId);
    if (!gmail) return AUTH_ERROR_MSG(userId);
    try {
      const message = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/html; charset=utf-8', '', body].join('\n');
      const raw = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return `✅ Enviado a ${to}`;
    } catch (err) { return `Error: ${err}`; }
  },
};

export const markEmailAsReadTool: Tool = {
  name: 'mark_email_as_read',
  description: 'Marca un email como leído quitando la etiqueta UNREAD.',
  parameters: {
    type: 'object',
    properties: {
      message_id: { type: 'string', description: 'ID del mensaje obtenido con read_email' },
    },
    required: ['message_id'],
  },
  execute: async (params, userId) => {
    const id = params.message_id as string;
    const gmail = await getGmailClient(userId);
    if (!gmail) return AUTH_ERROR_MSG(userId);

    try {
      await gmail.users.messages.modify({
        userId: 'me',
        id,
        requestBody: {
          removeLabelIds: ['UNREAD'],
        },
      });
      return `✅ Email marcado como leído`;
    } catch (err) { return `Error: ${err}`; }
  },
};
