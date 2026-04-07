import { google } from 'googleapis';
import fs from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import { config } from '../config.js';
import type { Tool } from './types.js';

import { firebase } from '../services/firebase.js';
import { generateAuthUrl, getOAuth2Client as getClientBase, getMasterToken } from '../services/auth.js';
import { sanitizeOutput, SEP } from '../utils/sanitize.js';

// Helper: Decodificar cuerpo de email desde base64url
function decodeEmailBody(data: string): string {
  try {
    return Buffer.from(data, 'base64url').toString('utf-8');
  } catch {
    return '';
  }
}

// Helper: Extraer cuerpo del email (prioriza text/plain)
function extractEmailBody(payload: any): string {
  // Si es texto plano directo
  if (payload.body?.data && payload.mimeType === 'text/plain') {
    return decodeEmailBody(payload.body.data);
  }

  // Si es HTML directo (convertir a texto)
  if (payload.body?.data && payload.mimeType === 'text/html') {
    const html = decodeEmailBody(payload.body.data);
    return htmlToPlainText(html);
  }

  // Si es multipart, buscar text/plain primero
  if (payload.parts) {
    // Primero buscar text/plain
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeEmailBody(part.body.data);
      }
    }
    // Si no hay text/plain, usar text/html
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeEmailBody(part.body.data);
        return htmlToPlainText(html);
      }
      // Recursivo para nested parts
      if (part.parts) {
        const nested = extractEmailBody(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

// Helper: Convertir HTML a texto plano
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getGmailClient(userId: string) {
  const oAuth2Client = getClientBase();
  if (!oAuth2Client) return null;

  // 1. Prioridad: Token específico del usuario en Firebase
  const userToken = await firebase.getUserToken(userId);
  if (userToken) {
    oAuth2Client.setCredentials(userToken);
    return google.gmail({ version: 'v1', auth: oAuth2Client });
  }

  // 2. MASTER TOKEN FALLBACK (Solo Administrador)
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
  return `🔑 Tu sesion de Google ha expirado.

Necesito que autorices de nuevo:

🔗 ${url}

Al hacer clic, seras redirigido a Google. Tras autorizar, vuelve a Telegram.`;
};

export const readEmailTool: Tool = {
  name: 'read_email',
  description: 'Lee los ultimos correos de la BANDEJA DE ENTRADA con cuerpo completo',
  parameters: {
    type: 'object',
    properties: {
      max_results: { type: 'number', description: 'Numero de correos a leer (default 5)' },
      include_body: { type: 'boolean', description: 'Incluir cuerpo completo (default false)' },
    },
  },
  execute: async (params, userId) => {
    try {
      const gmail = await getGmailClient(userId);
      if (!gmail) return AUTH_ERROR_MSG(userId);

      const maxResults = params.max_results as number || 5;
      const includeBody = params.include_body as boolean || false;

      const res = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        maxResults,
      });

      const messages = res.data.messages || [];
      if (messages.length === 0) return 'No se encontraron correos en la bandeja de entrada.';

      let output = `📬 **${messages.length} correos en BANDEJA DE ENTRADA:**\n\n`;

      for (const msg of messages) {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        });

        const payload = details.data.payload;
        const headers = payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || 'Sin asunto';
        const from = headers.find(h => h.name === 'From')?.value || 'Desconocido';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const threadId = details.data.threadId;

        const emailLink = `https://mail.google.com/mail/u/0/#inbox/${msg.id}`;

        output += `${SEP}\n`;
        output += `📧 **De:** ${from}\n`;
        output += `📋 **Asunto:** ${subject}\n`;
        output += `📅 **Fecha:** ${date}\n`;
        output += `🆔 **ID:** ${msg.id}\n`;
        output += `🔗 **Enlace directo:** ${emailLink}\n`;

        if (includeBody) {
          const body = extractEmailBody(payload);
          if (body) {
            output += `\n📝 **Cuerpo del mensaje:**\n${sanitizeOutput(body).slice(0, 1000)}\n`;
          }
        }
        output += '\n';
      }

      return sanitizeOutput(output);
    } catch (err) {
      console.error('Error en readEmailTool:', err);
      if (isUnauthorizedError(err)) return AUTH_ERROR_MSG(userId);
      return `Error al leer correos: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const getEmailDetailsTool: Tool = {
  name: 'get_email_details',
  description: 'Lee el cuerpo COMPLETO de un email especifico por su ID',
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
      const to = headers.find(h => h.name === 'To')?.value || '';
      const date = headers.find(h => h.name === 'Date')?.value || '';

      // Enlace directo al email
      const emailLink = `https://mail.google.com/mail/u/0/#inbox/${id}`;

      // Extraer cuerpo completo
      const body = extractEmailBody(payload) || msg.data.snippet || '(Sin contenido)';

      // Adjuntos
      const attachments: string[] = [];
      function findAttachments(parts: any[]) {
        for (const part of parts) {
          if (part.filename && part.body?.attachmentId) {
            attachments.push(`${part.filename} (ID: ${part.body.attachmentId})`);
          }
          if (part.parts) findAttachments(part.parts);
        }
      }
      if (payload?.parts) findAttachments(payload.parts);

      let output = `${SEP}\n`;
      output += `📧 **EMAIL COMPLETO**\n`;
      output += `${SEP}\n`;
      output += `**De:** ${from}\n`;
      output += `**Para:** ${to}\n`;
      output += `**Asunto:** ${subject}\n`;
      output += `**Fecha:** ${date}\n`;
      output += `**ID:** ${id}\n`;
      output += `🔗 **Enlace directo:** ${emailLink}\n`;
      output += `${SEP}\n\n`;
      output += `📝 **CUERPO DEL MENSAJE:**\n${sanitizeOutput(body)}\n\n`;
      output += `📎 **Adjuntos:** ${attachments.length ? attachments.join('\n') : 'Ninguno'}`;

      return sanitizeOutput(output);
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
      return `✅ **Adjunto guardado**
${SEP}
📎 **Archivo:** ${filename}
📂 **Ruta:** ${filePath}
${SEP}`;
    } catch (err) { return `Error: ${err}`; }
  },
};

export const sendEmailTool: Tool = {
  name: 'send_email',
  description: 'Envia un email usando Gmail.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Destinatario' },
      subject: { type: 'string', description: 'Asunto' },
      body: { type: 'string', description: 'Cuerpo del mensaje' },
    },
    required: ['to', 'subject', 'body'],
  },
  execute: async (params, userId) => {
    const { to, subject, body } = params as any;
    const gmail = await getGmailClient(userId);
    if (!gmail) return AUTH_ERROR_MSG(userId);
    try {
      const message = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset=utf-8', '', body].join('\n');
      const raw = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
      return `✅ **Email enviado**
${SEP}
📧 **Para:** ${to}
📋 **Asunto:** ${subject}
🆔 **ID:** ${result.data.id}
${SEP}`;
    } catch (err) { return `Error: ${err}`; }
  },
};

export const markEmailAsReadTool: Tool = {
  name: 'mark_email_as_read',
  description: 'Marca un email como leido.',
  parameters: {
    type: 'object',
    properties: {
      message_id: { type: 'string', description: 'ID del mensaje' },
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
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
      return `✅ **Email marcado como leído**
${SEP}
🆔 **ID:** ${id}
${SEP}`;
    } catch (err) { return `Error: ${err}`; }
  },
};

export const readSentEmailsTool: Tool = {
  name: 'read_sent_emails',
  description: 'Lee los ultimos correos ENVIADOS',
  parameters: {
    type: 'object',
    properties: {
      max_results: { type: 'number', description: 'Numero de correos (default 5)' },
    },
  },
  execute: async (params, userId) => {
    try {
      const gmail = await getGmailClient(userId);
      if (!gmail) return AUTH_ERROR_MSG(userId);

      const maxResults = params.max_results as number || 5;
      const res = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['SENT'],
        maxResults,
      });

      const messages = res.data.messages || [];
      if (messages.length === 0) return 'No se encontraron correos enviados.';

      let output = `📤 **${messages.length} correos ENVIADOS:**\n\n`;

      for (const msg of messages) {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        });

        const headers = details.data.payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || 'Sin asunto';
        const to = headers.find(h => h.name === 'To')?.value || 'Desconocido';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        output += `${SEP}\n`;
        output += `📧 **Para:** ${to}\n`;
        output += `📋 **Asunto:** ${subject}\n`;
        output += `📅 **Fecha:** ${date}\n`;
        output += `🆔 **ID:** ${msg.id}\n\n`;
      }

      return sanitizeOutput(output);
    } catch (err) {
      console.error('Error en readSentEmailsTool:', err);
      if (isUnauthorizedError(err)) return AUTH_ERROR_MSG(userId);
      return `Error al leer correos enviados: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};

export const searchEmailsTool: Tool = {
  name: 'search_emails',
  description: 'Busca correos por remitente, asunto o contenido',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Termino de busqueda (ej: "from:juan@gmail.com", "factura")' },
      max_results: { type: 'number', description: 'Maximo resultados (default 10)' },
    },
    required: ['query'],
  },
  execute: async (params, userId) => {
    try {
      const gmail = await getGmailClient(userId);
      if (!gmail) return AUTH_ERROR_MSG(userId);

      const query = params.query as string;
      const maxResults = params.max_results as number || 10;

      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });

      const messages = res.data.messages || [];
      if (messages.length === 0) return `No se encontraron correos para: "${query}"`;

      let output = `🔍 **${messages.length} resultados para "${query}":**\n\n`;

      for (const msg of messages) {
        const details = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'full',
        });

        const headers = details.data.payload?.headers || [];
        const subject = headers.find(h => h.name === 'Subject')?.value || 'Sin asunto';
        const from = headers.find(h => h.name === 'From')?.value || 'Desconocido';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        const emailLink = `https://mail.google.com/mail/u/0/#inbox/${msg.id}`;

        output += `${SEP}\n`;
        output += `📧 **De:** ${from}\n`;
        output += `📋 **Asunto:** ${subject}\n`;
        output += `📅 **Fecha:** ${date}\n`;
        output += `🔗 **Enlace directo:** ${emailLink}\n\n`;
      }

      return sanitizeOutput(output);
    } catch (err) {
      console.error('Error en searchEmailsTool:', err);
      if (isUnauthorizedError(err)) return AUTH_ERROR_MSG(userId);
      return `Error al buscar correos: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};