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

// 🔄 Helper para obtener TODOS los archivos con paginación completa
async function fetchAllFiles(drive: any, q: string, fields = 'files(id, name, mimeType, size, webViewLink)') {
  let allFiles: any[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const res: any = await drive.files.list({
        q,
        fields: `nextPageToken, ${fields}`,
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      if (res.data.files) {
        allFiles.push(...res.data.files);
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    return allFiles;
  } catch (err) {
    console.error('❌ Error en fetchAllFiles:', err);
    throw err;
  }
}

// 📂 Obtiene o crea la carpeta de uploads oficial
export async function getOrCreateUploadsFolder(drive: any) {
  try {
    const q = "name = 'opencodeagent_uploads' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const res = await drive.files.list({ q, fields: 'files(id, name)' });
    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }
    
    // Crear si no existe
    const createRes = await drive.files.create({
      requestBody: {
        name: 'opencodeagent_uploads',
        mimeType: 'application/vnd.google-apps.folder'
      },
      fields: 'id'
    });
    return createRes.data.id;
  } catch (err) {
    console.error('Error gestionando carpeta uploads:', err);
    return null;
  }
}

// 🔍 Resuelve el ID de una carpeta por nombre (busca la primera coincidencia exacta)
async function resolveFolder(drive: any, folderName: string): Promise<{ id: string; name: string } | null> {
  const safeName = folderName.replace(/'/g, "\\'");
  const q = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const results = await fetchAllFiles(drive, q, 'files(id, name)');
  if (results.length > 0) return { id: results[0].id, name: results[0].name };

  // Intentar búsqueda parcial si no hay exacta
  const q2 = `name contains '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const results2 = await fetchAllFiles(drive, q2, 'files(id, name)');
  return results2.length > 0 ? { id: results2[0].id, name: results2[0].name } : null;
}

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
      only_folders: { type: 'boolean', description: 'Si es true, solo buscará carpetas' },
      only_files: { type: 'boolean', description: 'Si es true, solo buscará archivos' },
    },
    required: ['query'],
  },
  execute: async (params, userId) => {
    const qTerm = params.query as string;
    const onlyFolders = params.only_folders as boolean | undefined;
    const onlyFiles = params.only_files as boolean | undefined;

    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      // Escapar comillas simples para evitar errores en la query
      const safeQuery = qTerm.replace(/'/g, "\\'");
      let q = `name contains '${safeQuery}' and trashed = false`;
      if (onlyFolders) q += ` and mimeType = 'application/vnd.google-apps.folder'`;
      if (onlyFiles) q += ` and mimeType != 'application/vnd.google-apps.folder'`;
      
      const files = await fetchAllFiles(drive, q);

      if (files.length === 0) return `No se encontraron ${onlyFolders ? 'carpetas' : 'archivos'} que contengan: "${qTerm}"`;

      // Separar carpetas y archivos
      const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
      const realFiles = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');

      let output = `🔍 **Resultados para "${qTerm}":**\n`;
      output += `Total: ${files.length} (${folders.length} carpetas, ${realFiles.length} archivos)\n\n`;
      
      const displayList = [...folders, ...realFiles].slice(0, 40);
      
      for (const f of displayList) {
        const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
        const icon = isFolder ? '📁' : '📄';
        const link = f.webViewLink || (isFolder ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}/view`);
        
        output += `${icon} [${f.name}](${link}) \\| \`${f.id}\`\n`;
      }

      if (files.length > 40) {
        output += `\n... y ${files.length - 40} resultados más.`;
      }

      return output;
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
  description: 'Lista archivos en Google Drive. Puedes filtrar por carpeta usando folder_id o folder_name.',
  parameters: {
    type: 'object',
    properties: {
      max_results: { type: 'number', description: 'Maximo archivos a mostrar (default 20)' },
      folder_id: { type: 'string', description: 'ID exacto de la carpeta (opcional, tiene prioridad sobre folder_name)' },
      folder_name: { type: 'string', description: 'Nombre de la carpeta a listar (se busca automáticamente en Drive)' },
      only_folders: { type: 'boolean', description: 'Si es true, solo mostrará carpetas' },
      only_files: { type: 'boolean', description: 'Si es true, solo mostrará archivos (no carpetas)' },
    },
    required: [],
  },
  execute: async (params, userId) => {
    const maxResults = (params.max_results as number) || 20;
    let folderId = params.folder_id as string | undefined;
    const folderName = params.folder_name as string | undefined;
    const onlyFolders = params.only_folders as boolean | undefined;
    const onlyFiles = params.only_files as boolean | undefined;

    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    try {
      // Si dieron nombre de carpeta en vez de ID, resolver el ID primero
      let resolvedFolderName = '';
      if (!folderId && folderName) {
        const found = await resolveFolder(drive, folderName);
        if (!found) {
          return `❌ No encontré ninguna carpeta llamada "${folderName}" en tu Drive.\n\nEspecifícame el ID si la conoces.`;
        }
        folderId = found.id;
        resolvedFolderName = found.name;
      }

      let q = 'trashed = false';
      if (folderId) q += ` and '${folderId}' in parents`;
      if (onlyFolders) q += ` and mimeType = 'application/vnd.google-apps.folder'`;
      if (onlyFiles) q += ` and mimeType != 'application/vnd.google-apps.folder'`;

      const files = await fetchAllFiles(drive, q, 'files(id, name, mimeType, size, webViewLink)');

      if (files.length === 0) {
        const donde = resolvedFolderName || folderName || (folderId ? `carpeta ${folderId}` : 'tu Drive');
        return `📁 No se encontraron ${onlyFolders ? 'carpetas' : 'archivos'} en "${donde}".`;
      }

      // Separar carpetas y archivos para mejor visualización
      const folders = files.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
      const realFiles = files.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');

      const header = resolvedFolderName
        ? `📁 **Contenido de "${resolvedFolderName}":**`
        : `📁 **Contenido de la raíz de Google Drive:**`;
      
      let output = `${header}\n`;
      output += `Total: ${files.length} (${folders.length} carpetas, ${realFiles.length} archivos)\n\n`;

      const displayList = [...folders, ...realFiles].slice(0, 50);

      for (const f of displayList) {
        const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
        const icon = isFolder ? '📁' : '📄';
        const link = f.webViewLink ||
          (isFolder ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}/view`);
        output += `${icon} [${f.name}](${link}) \\| \`${f.id}\`\n`;
      }

      if (files.length > 50) {
        output += `\n⚠️ *Mostrando 50 de ${files.length}. Usa search_drive para filtrar más.*`;
      }

      return output;
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
      const safeName = name.replace(/'/g, "\\'");
      const q = `name contains '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const folders = await fetchAllFiles(drive, q, 'files(id, name, webViewLink)');

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
  description: 'Mueve uno o varios archivos/carpetas a una nueva ubicación en Drive. Acepta ID o nombre de destino.',
  parameters: {
    type: 'object',
    properties: {
      file_id: { type: 'string', description: 'ID del archivo/carpeta a mover (para mover uno solo)' },
      file_ids: { type: 'array', items: { type: 'string' }, description: 'Lista de IDs para mover varios a la vez' },
      new_parent_id: { type: 'string', description: 'ID de la carpeta destino (tiene prioridad sobre new_parent_name)' },
      new_parent_name: { type: 'string', description: 'Nombre de la carpeta destino (se busca automáticamente)' },
    },
    required: [],
  },
  execute: async (params, userId) => {
    const drive = await getDriveClient(userId);
    if (!drive) return AUTH_ERROR_MSG(userId);

    // Consolidar lista de IDs a mover
    const idsToMove: string[] = [];
    if (params.file_id) idsToMove.push(params.file_id as string);
    if (params.file_ids && Array.isArray(params.file_ids)) {
      idsToMove.push(...(params.file_ids as string[]));
    }

    if (idsToMove.length === 0) {
      return '❌ Debes indicar file_id o file_ids para mover archivos.';
    }

    // Resolver carpeta destino
    let newParentId = params.new_parent_id as string | undefined;
    let destName = newParentId || '';

    if (!newParentId && params.new_parent_name) {
      const found = await resolveFolder(drive, params.new_parent_name as string);
      if (!found) {
        return `❌ No encontré ninguna carpeta llamada "${params.new_parent_name}" en tu Drive.\nUsa search_drive_folder para buscarla.`;
      }
      newParentId = found.id;
      destName = found.name;
    }

    if (!newParentId) {
      return '❌ Debes indicar new_parent_id o new_parent_name (carpeta destino).';
    }

    try {
      const results: string[] = [];

      for (const fileId of idsToMove) {
        try {
          const file = await drive.files.get({ fileId, fields: 'parents, name' });
          const currentParents = (file.data.parents || []).join(',');

          await drive.files.update({
            fileId,
            addParents: newParentId as string,
            removeParents: currentParents || undefined,
            fields: 'id, parents',
          });

          results.push(`✅ "${file.data.name}" movido correctamente`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push(`❌ Error moviendo ID ${fileId}: ${msg}`);
        }
      }

      const summary = results.join('\n');
      return `📦 **Resultado del movimiento a "${destName}":**\n\n${summary}`;
    } catch (error) {
      return `Error moviendo archivos en Drive: ${error instanceof Error ? error.message : String(error)}`;
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