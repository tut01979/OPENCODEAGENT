import { google } from 'googleapis';
import fs from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import { config } from '../config.js';
import type { Tool } from './types.js';

import { firebase } from '../services/firebase.js';
import { generateAuthUrl, getOAuth2Client as getClientBase, getMasterToken } from '../services/auth.js';

async function getGmailClient(userId: string) {
  const oAuth2Client = getClientBase();
  if (!oAuth2Client) return null;

  // 1. Prioridad: Token específico del usuario en Firebase
  const userToken = await firebase.getUserToken(userId);
  if (userToken) {
    oAuth2Client.setCredentials(userToken);
    return google.gmail({ version: 'v1', auth: oAuth2Client });
  }

  // 🛡️ MASTER TOKEN FALLBACK (Solo Administrador)
  if (userId === config.telegram.adminId) {
    const masterToken = getMasterToken();
    if (masterToken) {
      oAuth2Client.setCredentials(masterToken);
      return google.gmail({ version: 'v1', auth: oAuth2Client });
    }
  }

  return null;
}

function isUnauthorizedError(err: unknown): boolean {
  const msg = String(err);
  return msg.includes('unauthorized_client') || msg.includes('invalid_grant') || msg.includes('Token has been expired') || msg.includes('Invalid Credentials');
}

const AUTH_ERROR_MSG = (userId: string) => {
  const url = generateAuthUrl(userId);
  return `🔑 **Tu sesión de Google ha expirado.**\n\nNecesito que autorices de nuevo. Solo es una vez:\n\n🔗 ${url}\n\nAl hacer clic, serás redirigido a Google. Tras autorizar, vuelve a Telegram y repite tu solicitud.`;
};

export const readEmailTool: Tool = {
  name: 'read_email',
  description: 'Lee los últimos correos del usuario',
  parameters: {
    type: 'object',
    properties: {
      max_results: { type: 'number', description: 'Número de correos a leer (default 5)' },
    },
  },
  execute: async (params, userId) => {
    try {
      const gmail = await getGmailClient(userId);
      if (!gmail) return AUTH_ERROR_MSG(userId);

      const maxResults = params.max_results as number || 5;
      const res = await gmail.users.messages.list({
        userId: 'me',
        maxResults,
      });

      const messages = res.data.messages || [];
      if (messages.length === 0) return 'No se encontraron correos.';

      let output = `📬 Se encontraron ${messages.length} correos:\n\n`;
      for (const msg of messages) {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
        });
        const headers = details.data.payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || 'Sin asunto';
        const from = headers.find(h => h.name === 'From')?.value || 'Desconocido';
        output += `➖ **De:** ${from}\n**Asunto:** ${subject}\n**ID:** ${msg.id}\n\n`;
      }
      return output;
    } catch (err) {
      console.error('Error en readEmailTool:', err);
      // Si el token caducó o fue rechazado, enviamos el enlace de autorización
      if (isUnauthorizedError(err)) return AUTH_ERROR_MSG(userId);
      return `Error al leer correos: ${err instanceof Error ? err.message : String(err)}`;
    }
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
      const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const payload = msg.data.payload;
      const headers = payload?.headers || [];
      const subject = headers.find(h => h.name === 'Subject')?.value || 'Sin asunto';
      const from = headers.find(h => h.name === 'From')?.value || 'Desconocido';
      const date = headers.find(h => h.name === 'Date')?.value || '';
      let body = '';

      // Extraer cuerpo recursivamente (soporta mensajes multipart)
      function extractBody(parts: any[]): string {
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            return Buffer.from(part.body.data, 'base64url').toString('utf-8');
          }
          if (part.parts) {
            const nested = extractBody(part.parts);
            if (nested) return nested;
          }
        }
        return '';
      }

      if (payload?.parts) {
        body = extractBody(payload.parts);
      } else if (payload?.body?.data) {
        body = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      }

      if (!body) body = msg.data.snippet || '(Sin cuerpo de texto)';

      const attachments = payload?.parts?.filter((p: any) => p.filename && p.body?.attachmentId)
        .map((p: any) => `- ${p.filename} (ID: ${p.body?.attachmentId})`) || [];

      return `📧 **Email:**\n**De:** ${from}\n**Asunto:** ${subject}\n**Fecha:** ${date}\n\n**Cuerpo:**\n${body.slice(0, 3000)}\n\n**Adjuntos:** ${attachments.length ? attachments.join('\n') : 'Ninguno'}`;
    } catch (err) {
      console.error('Error en getEmailDetailsTool:', err);
      if (isUnauthorizedError(err)) return AUTH_ERROR_MSG(userId);
      return `Error al leer email ${id}: ${err instanceof Error ? err.message : String(err)}`;
    }
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
