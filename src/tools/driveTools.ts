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

async function getDriveClient(userId: string) {
  try {
    const oAuth2Client = getClientBase();
    if (!oAuth2Client) return null;

    // 1. PRIORIDAD: OAuth2 (Acceso personal del usuario desde Firebase)
    const userToken = await firebase.getUserToken(userId);
    if (userToken) {
      oAuth2Client.setCredentials(userToken);
      return google.drive({ version: 'v3', auth: oAuth2Client });
    }

    // 🛡️ MASTER TOKEN FALLBACK (Solo Administrador)
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
  return `⚠️ No estás conectado con Google. Para acceder a tus archivos de Drive, autoriza aquí:\n\n🔗 ${url}\n\nDespués de autorizar, repíteme tu solicitud.`;
};

export const readDriveFileTool: Tool = {
  name: 'read_drive_file',
  description: 'Lee el contenido de un archivo en Google Drive (soporta Google Docs, PDF y Texto)',
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
      const metadata = await drive.files.get({ fileId, fields: 'name, mimeType' });
      const { name, mimeType } = metadata.data;

      // 1. Si es un Google Doc, lo exportamos como texto plano
      if (mimeType === 'application/vnd.google-apps.document') {
        const response = await drive.files.export({
          fileId,
          mimeType: 'text/plain',
        });
        return `📄 Contenido de Google Doc (${name}):\n\n${response.data}`;
      }

      // 2. Si es PDF, lo descargamos y extraemos texto
      if (mimeType === 'application/pdf') {
        const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data as any);
        const data = await PDFParse(buffer);
        return `📄 Contenido de PDF (${name}):\n\n${data.text}`;
      }

      // 3. Si es texto plano o similar
      if (mimeType?.includes('text/') || mimeType === 'application/json') {
        const response = await drive.files.get({ fileId, alt: 'media' });
        const content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
        return `📄 Contenido de archivo (${name}):\n\n${content}`;
      }

      return `⚠️ El archivo ${name} tiene un tipo (${mimeType}) que no se puede leer directamente como texto.`;
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
      if (files.length === 0) return `No se encontraron archivos que coincidan con "${qTerm}"`;

      return `Resultados de búsqueda:\n\n` + files.map(f => `- ${f.name || 'Sin nombre'} (${f.mimeType || 'Sin tipo'})\n  ID: ${f.id || 'Sin ID'}\n  Link: ${f.webViewLink || 'Sin link'}`).join('\n\n');
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
      file_path: {
        type: 'string',
        description: 'Ruta local del archivo a subir',
      },
      folder_id: {
        type: 'string',
        description: 'ID de carpeta en Drive (opcional, por defecto raíz)',
      },
      name: {
        type: 'string',
        description: 'Nombre del archivo en Drive (opcional)',
      },
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
        return `Error: Archivo no encontrado: ${absolutePath}`;
      }

      const fileMetadata: any = {
        name: fileName,
      };

      if (folderId) {
        fileMetadata.parents = [folderId];
      }

      const ext = path.extname(absolutePath).toLowerCase();
      let mimeType = 'application/octet-stream';
      if (ext === '.pdf') mimeType = 'application/pdf';
      else if (ext === '.txt' || ext === '.md') mimeType = 'text/plain';
      else if (ext === '.csv') mimeType = 'text/csv';
      else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
      else if (ext === '.png') mimeType = 'image/png';

      const media = {
        mimeType,
        body: fs.createReadStream(absolutePath),
      };

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink',
      });

      return `✅ Archivo subido a Google Drive:\nNombre: ${response.data.name || 'Sin nombre'}\nID: ${response.data.id || 'Sin ID'}\nLink: ${response.data.webViewLink || 'Sin link'}`;
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
      max_results: {
        type: 'number',
        description: 'Número máximo de archivos (default: 10)',
      },
      folder_id: {
        type: 'string',
        description: 'ID de carpeta (opcional)',
      },
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
      if (folderId) {
        q += ` and '${folderId}' in parents`;
      }

      const response = await drive.files.list({
        q,
        pageSize: maxResults,
        fields: 'files(id, name, mimeType, size, webViewLink)',
        orderBy: 'modifiedTime desc',
      });

      const files = response.data.files || [];
      if (files.length === 0) {
        return 'No se encontraron archivos en Drive';
      }

      const fileList = files.map(f => `- ${f.name || 'Sin nombre'} (${f.mimeType || 'Sin tipo'})\n  ID: ${f.id || 'Sin ID'}\n  Link: ${f.webViewLink || 'Sin link'}`);
      return `Archivos en Google Drive:\n\n${fileList.join('\n\n')}`;
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
      name: {
        type: 'string',
        description: 'Nombre de la carpeta',
      },
      parent_id: {
        type: 'string',
        description: 'ID de la carpeta padre (opcional)',
      },
    },
    required: ['name'],
  },
  execute: async (params, userId) => {
    const name = params.name as string;
    const parentId = params.parent_id as string;
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      const fileMetadata = {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: parentId ? [parentId] : undefined,
      };

      const response = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, webViewLink',
      });

      return `✅ Carpeta creada:\nNombre: ${response.data.name}\nID: ${response.data.id}\nLink: ${response.data.webViewLink}`;
    } catch (error) {
      return `Error creando carpeta: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const deleteDriveFileTool: Tool = {
  name: 'delete_drive_file',
  description: 'Mueve un archivo o carpeta a la papelera en Google Drive',
  parameters: {
    type: 'object',
    properties: {
      file_id: {
        type: 'string',
        description: 'ID de archivo o carpeta a eliminar',
      },
    },
    required: ['file_id'],
  },
  execute: async (params, userId) => {
    const fileId = params.file_id as string;
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      await drive.files.update({
        fileId,
        requestBody: { trashed: true },
      });
      return `✅ Archivo/Carpeta con ID ${fileId} movido a la papelera.`;
    } catch (error) {
      return `Error eliminando de Drive: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
