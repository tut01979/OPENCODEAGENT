import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import type { Tool } from './types.js';

// @ts-ignore
import PDFParse from 'pdf-parse';

const TOKEN_PATH = './token.json';
const CREDENTIALS_PATH = './gmail-credentials.json';

async function getDriveClient() {
  // 1. PRIORIDAD: OAuth2 (Acceso personal del usuario)
  try {
    if (fs.existsSync(TOKEN_PATH) && fs.existsSync(CREDENTIALS_PATH)) {
      const credentialsContent = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
      const credentials = JSON.parse(credentialsContent);
      const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

      const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
      );

      const tokenContent = fs.readFileSync(TOKEN_PATH, 'utf-8');
      oAuth2Client.setCredentials(JSON.parse(tokenContent));

      return google.drive({ version: 'v3', auth: oAuth2Client });
    }
  } catch (err) {
    console.warn('Fallo OAuth2 en Drive:', err);
  }

  // 2. FALLBACK: Service Account
  try {
    const creds = config.firebase.credentials;
    const credentialsPath = path.isAbsolute(creds) ? creds : path.join(process.cwd(), creds);
    
    if (fs.existsSync(credentialsPath)) {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/drive'],
      });
      const authClient = await auth.getClient();
      return google.drive({ version: 'v3', auth: authClient as any });
    }
  } catch (err) {
    console.warn('Fallo Service Account en Drive:', err);
  }

  return null;
}

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
  execute: async (params) => {
    const fileId = params.file_id as string;
    const drive = await getDriveClient();
    if (!drive) return '⚠️ Drive no configurado.';

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
  execute: async (params) => {
    const qTerm = params.query as string;
    const drive = await getDriveClient();
    if (!drive) return '⚠️ Drive no configurado.';

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
  execute: async (params) => {
    const filePath = params.file_path as string;
    const folderId = params.folder_id as string;
    const fileName = (params.name as string) || path.basename(filePath);

    const drive = await getDriveClient();
    if (!drive) {
      return '⚠️ Google Drive no configurado. Necesitas configurar OAuth2 primero.';
    }

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
  execute: async (params) => {
    const maxResults = (params.max_results as number) || 10;
    const folderId = params.folder_id as string;

    const drive = await getDriveClient();
    if (!drive) {
      return '⚠️ Google Drive no configurado.';
    }

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
  execute: async (params) => {
    const name = params.name as string;
    const parentId = params.parent_id as string;
    const drive = await getDriveClient();
    if (!drive) return '⚠️ Drive no configurado.';

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
  execute: async (params) => {
    const fileId = params.file_id as string;
    const drive = await getDriveClient();
    if (!drive) return '⚠️ Drive no configurado.';

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
