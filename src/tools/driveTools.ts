import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import type { Tool } from './types.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PDFParse = require('pdf-parse');

import { firebase } from '../services/firebase.js';
import { generateAuthUrl, getOAuth2Client as getClientBase, getMasterToken } from '../services/auth.js';
import { sanitizeOutput, SEP } from '../utils/sanitize.js';

export async function getDriveClient(userId: string) {
  try {
    const oAuth2Client = getClientBase();
    if (!oAuth2Client) return null;

    const userToken = await firebase.getUserToken(userId);
    if (userToken) {
      oAuth2Client.setCredentials(userToken);
      return google.drive({ version: 'v3', auth: oAuth2Client });
    }

    if (userId === config.telegram.adminId) {
      const masterToken = getMasterToken();
      if (masterToken) {
        oAuth2Client.setCredentials(masterToken);
        return google.drive({ version: 'v3', auth: oAuth2Client });
      }
    }
  } catch (err) {
    console.warn('Fallo en Drive Client:', err);
  }
  return null;
}

const AUTH_ERROR_MSG = (userId: string) => {
  const url = generateAuthUrl(userId);
  return `No estas conectado con Google. Autoriza aqui:

${url}

Despues de autorizar, repiteme tu solicitud.`;
};

export const readDriveFileTool: Tool = {
  name: 'read_drive_file',
  description: 'Lee el contenido de un archivo en Google Drive (Google Docs, PDF, Texto)',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'ID del archivo en Drive' },
    },
    required: ['file_id'],
  },
  execute: async (params, userId) => {
    const fileId = params.file_id as string;
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      const metadata = await drive.files.get({ fileId, fields: 'name, mimeType, webViewLink' });
      const { name, mimeType, webViewLink } = metadata.data;
      const link = webViewLink || `https://drive.google.com/file/d/${fileId}/view`;

      // Google Doc -> exportar como texto
      if (mimeType === 'application/vnd.google-apps.document') {
        const response = await drive.files.export({ fileId, mimeType: 'text/plain' });
        return `${SEP}
📄 **Google Doc: ${name}**
🔗 **Enlace directo:** ${link}
${SEP}

Contenido:
${sanitizeOutput(String(response.data))}`;
      }

      // PDF -> extraer texto
      if (mimeType === 'application/pdf') {
        const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data as any);
        const data = await PDFParse(buffer);
        return `${SEP}
📄 **PDF: ${name}**
🔗 **Enlace directo:** ${link}
${SEP}

Contenido:
${sanitizeOutput(data.text)}`;
      }

      // Texto plano o JSON
      if (mimeType?.includes('text/') || mimeType === 'application/json') {
        const response = await drive.files.get({ fileId, alt: 'media' });
        const content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
        return `${SEP}
📄 **Archivo: ${name}**
🔗 **Enlace directo:** ${link}
${SEP}

Contenido:
${sanitizeOutput(content)}`;
      }

      return `${SEP}
📄 **${name}**
📂 Tipo: ${mimeType}
🔗 **Enlace directo:** ${link}
${SEP}`;
    } catch (error) {
      return `Error leyendo archivo de Drive: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const searchDriveFilesTool: Tool = {
  name: 'search_drive',
  description: 'Busca archivos en Google Drive por nombre',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Nombre o parte del nombre a buscar' },
    },
    required: ['query'],
  },
  execute: async (params, userId) => {
    const qTerm = params.query as string;
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      const response = await drive.files.list({
        q: `name contains '${qTerm}' and trashed = false`,
        fields: 'files(id, name, mimeType, webViewLink)',
      });

      const files = response.data.files || [];
      if (files.length === 0) return `No se encontraron archivos para: "${qTerm}"`;

      let output = `🔍 **${files.length} archivos encontrados para "${qTerm}":**\n\n`;
      for (const f of files) {
        const link = f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`;
        output += `${SEP}
📄 **${f.name}**
**Tipo:** ${f.mimeType || 'Desconocido'}
**ID:** ${f.id}
🔗 **Enlace directo:** ${link}
${SEP}\n\n`;
      }

      return sanitizeOutput(output);
    } catch (error) {
      return `Error buscando en Drive: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const uploadFileDriveTool: Tool = {
  name: 'upload_to_drive',
  description: 'Sube un archivo a Google Drive',
  parameters: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Ruta local del archivo' },
      folder_id: { type: 'string', description: 'ID de carpeta en Drive (opcional)' },
      name: { type: 'string', description: 'Nombre del archivo en Drive (opcional)' },
    },
    required: ['file_path'],
  },
  execute: async (params, userId) => {
    const filePath = params.file_path as string;
    const folderId = params.folder_id as string;
    const fileName = (params.name as string) || path.basename(filePath);

    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      const absolutePath = path.resolve(filePath);
      if (!fs.existsSync(absolutePath)) {
        return `Archivo no encontrado: ${absolutePath}`;
      }

      const fileMetadata: any = { name: fileName };
      if (folderId) fileMetadata.parents = [folderId];

      const ext = path.extname(absolutePath).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.pdf') mimeType = 'application/pdf';
      else if (ext === '.txt' || ext === '.md') mimeType = 'text/plain';
      else if (ext === '.csv') mimeType = 'text/csv';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.png') mimeType = 'image/png';

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: { mimeType, body: fs.createReadStream(absolutePath) },
        fields: 'id, name, webViewLink',
      });

      const link = response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view`;

      return `✅ **Archivo subido a Google Drive**
${SEP}
📄 **Nombre:** ${response.data.name}
🆔 **ID:** ${response.data.id}
🔗 **Enlace directo:** ${link}
${SEP}`;
    } catch (error) {
      return `Error subiendo archivo: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const listDriveFilesTool: Tool = {
  name: 'list_drive_files',
  description: 'Lista archivos en Google Drive',
  parameters: {
    type: 'object',
    properties: {
      max_results: { type: 'number', description: 'Maximo archivos (default 10)' },
      folder_id: { type: 'string', description: 'ID de carpeta (opcional)' },
    },
    required: [],
  },
  execute: async (params, userId) => {
    const maxResults = (params.max_results as number) || 10;
    const folderId = params.folder_id as string;

    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      let q = "trashed = false";
      if (folderId) q += ` and '${folderId}' in parents`;

      const response = await drive.files.list({
        q,
        pageSize: maxResults,
        fields: 'files(id, name, mimeType, size, webViewLink)',
        orderBy: 'modifiedTime desc',
      });

      const files = response.data.files || [];
      if (files.length === 0) return 'No se encontraron archivos en Drive';

      let output = `📁 **${files.length} archivos en Google Drive:**\n\n`;
      for (const f of files) {
        const link = f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`;
        const size = f.size ? `${(Number(f.size) / 1024).toFixed(1)} KB` : 'N/A';
        output += `${SEP}
📄 **${f.name}**
**Tipo:** ${f.mimeType?.split('/').pop() || 'Desconocido'}
**Tamaño:** ${size}
**ID:** ${f.id}
🔗 **Enlace directo:** ${link}
${SEP}\n\n`;
      }

      return sanitizeOutput(output);
    } catch (error) {
      return `Error listando archivos: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const createDriveFolderTool: Tool = {
  name: 'create_drive_folder',
  description: 'Crea una nueva carpeta en Google Drive',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre de la carpeta' },
      parent_id: { type: 'string', description: 'ID de carpeta padre (opcional)' },
    },
    required: ['name'],
  },
  execute: async (params, userId) => {
    const name = params.name as string;
    const parentId = params.parent_id as string;
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      const fileMetadata: any = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      };

      const response = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, webViewLink',
      });

      const link = response.data.webViewLink || `https://drive.google.com/drive/folders/${response.data.id}`;

      return `✅ **Carpeta creada en Google Drive**
${SEP}
📁 **Nombre:** ${response.data.name}
🆔 **ID:** ${response.data.id}
🔗 **Enlace directo:** ${link}
${SEP}`;
    } catch (error) {
      return `Error creando carpeta: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const searchDriveFolderTool: Tool = {
  name: 'search_drive_folder',
  description: 'Busca una carpeta en Google Drive por nombre exacto o parcial',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre de la carpeta' },
    },
    required: ['name'],
  },
  execute: async (params, userId) => {
    const name = params.name as string;
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      const response = await drive.files.list({
        q: `name contains '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name, webViewLink)',
      });

      const folders = response.data.files || [];
      if (folders.length === 0) return `No se encontró ninguna carpeta con el nombre: "${name}"`;

      let output = `📁 **Carpetas encontradas:**\n\n`;
      for (const f of folders) {
        const link = f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`;
        output += `${SEP}\n📁 **${f.name}**\n🆔 ID: \`${f.id}\`\n🔗 **Enlace:** ${link}\n${SEP}\n\n`;
      }
      return sanitizeOutput(output);
    } catch (error) {
      return `Error buscando carpeta: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
};

export const deleteDriveFileTool: Tool = {
  name: 'delete_drive_file',
  description: 'Mueve un archivo o carpeta a la papelera',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'ID del archivo o carpeta' },
    },
    required: ['file_id'],
  },
  execute: async (params, userId) => {
    const fileId = params.file_id as string;
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      const metadata = await drive.files.get({ fileId, fields: 'name' });
      const name = metadata.data.name;

      await drive.files.update({ fileId, requestBody: { trashed: true } });

      return `🗑️ **Archivo movido a la papelera**
${SEP}
📄 **Nombre:** ${name}
🆔 **ID:** ${fileId}
${SEP}`;
    } catch (error) {
      return `Error eliminando de Drive: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const moveDriveFileTool: Tool = {
  name: 'move_drive_file',
  description: 'Mueve un archivo o carpeta a una nueva ubicación en Drive',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'ID del archivo o carpeta a mover' },
      new_parent_id: { type: 'string', description: 'ID de la carpeta destino' },
    },
    required: ['file_id', 'new_parent_id'],
  },
  execute: async (params, userId) => {
    const fileId = params.file_id as string;
    const newParentId = params.new_parent_id as string;
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      // 1. Obtener el archivo y sus padres actuales
      const file = await drive.files.get({ fileId, fields: 'parents, name' });
      const currentParents = (file.data.parents || []).join(',');

      // 2. Mover: añadir nuevo, quitar antiguos
      // NOTA: Si currentParents está vacío, Google lo ignora.
      await drive.files.update({
        fileId,
        addParents: newParentId,
        removeParents: currentParents || undefined, 
        fields: 'id, parents',
      });

      return `✅ **Éxito:** Movi "${file.data.name}" a la nueva ubicación.
🆔 **Archivo:** ${fileId}
📂 **Carpeta destino:** ${newParentId}`;
    } catch (error) {
      return `Error moviendo en Drive: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const updateDriveFileTool: Tool = {
  name: 'update_drive_file',
  description: 'Renombra o actualiza los metadatos de un archivo en Drive',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'ID del archivo a actualizar' },
      new_name: { type: 'string', description: 'Nuevo nombre para el archivo' },
    },
    required: ['file_id', 'new_name'],
  },
  execute: async (params, userId) => {
    const fileId = params.file_id as string;
    const newName = params.new_name as string;
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      const response = await drive.files.update({
        fileId,
        requestBody: { name: newName },
        fields: 'id, name, webViewLink',
      });

      const link = response.data.webViewLink || `https://drive.google.com/file/d/${response.data.id}/view`;

      return `✅ **Archivo actualizado correctamente**
${SEP}
📄 **Nuevo Nombre:** ${response.data.name}
🆔 **ID:** ${response.data.id}
🔗 **Enlace:** ${link}
${SEP}`;
    } catch (error) {
      return `Error actualizando archivo en Drive: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};