import fs from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { config } from '../config.js';
import type { Tool } from './types.js';

import { firebase } from '../services/firebase.js';
import { generateAuthUrl, getOAuth2Client as getClientBase } from '../services/auth.js';

async function getSheetsClient(userId: string) {
  try {
    const oAuth2Client = getClientBase();
    if (!oAuth2Client) return null;

    const userToken = await firebase.getUserToken(userId);
    if (userToken) {
      oAuth2Client.setCredentials(userToken);
      return google.sheets({ version: 'v4', auth: oAuth2Client });
    }

    try {
      const TOKEN_PATH = './data/token.json';
      if (fs_sync.existsSync(TOKEN_PATH)) {
        const tokenContent = await fs.readFile(path.resolve(TOKEN_PATH), 'utf-8');
        oAuth2Client.setCredentials(JSON.parse(tokenContent));
        return google.sheets({ version: 'v4', auth: oAuth2Client });
      }
    } catch {}

    return null;
  } catch {
    return null;
  }
}

const AUTH_ERROR_MSG = (userId: string) => {
  const url = generateAuthUrl(userId);
  return `⚠️ No estás conectado con Google. Para gestionar tus Google Sheets, autoriza aquí:\n\n🔗 ${url}\n\nDespués, inténtalo de nuevo.`;
};

export const readSheetTool: Tool = {
  name: 'read_sheet',
  description: 'Lee datos de una hoja de Google Sheets',
  parameters: {
    type: 'object',
    properties: {
      spreadsheet_id: {
        type: 'string',
        description: 'ID del spreadsheet (de la URL)',
      },
      range: {
        type: 'string',
        description: 'Rango de celdas (ej: "Sheet1!A1:D10")',
      },
    },
    required: ['spreadsheet_id', 'range'],
  },
  execute: async (params, userId) => {
    const spreadsheetId = params.spreadsheet_id as string;
    const range = params.range as string;
    const sheets = await getSheetsClient(userId);
    if (!sheets) return AUTH_ERROR_MSG(userId);

    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });

      const rows = response.data.values || [];
      if (rows.length === 0) {
        return 'No se encontraron datos en el rango especificado';
      }

      // Formatear como tabla
      let table = '';
      for (let i = 0; i < rows.length; i++) {
        table += rows[i].join(' | ') + '\n';
      }

      return `Datos de la hoja:\n\n${table}`;
    } catch (error) {
      return `Error leyendo hoja: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const writeSheetTool: Tool = {
  name: 'write_sheet',
  description: 'Escribe datos en una hoja de Google Sheets',
  parameters: {
    type: 'object',
    properties: {
      spreadsheet_id: {
        type: 'string',
        description: 'ID del spreadsheet (de la URL)',
      },
      range: {
        type: 'string',
        description: 'Rango de celdas (ej: "Sheet1!A1")',
      },
      values: {
        type: 'string',
        description: 'Datos separados por punto y coma para filas y coma para columnas (ej: "Nombre,Edad;Juan,25;Ana,30")',
      },
    },
    required: ['spreadsheet_id', 'range', 'values'],
  },
  execute: async (params, userId) => {
    const spreadsheetId = params.spreadsheet_id as string;
    const range = params.range as string;
    const valuesStr = params.values as string;

    const sheets = await getSheetsClient(userId);
    if (!sheets) return AUTH_ERROR_MSG(userId);

    try {
      // Parsear valores
      const rows = valuesStr.split(';').map(row => row.split(',').map(cell => cell.trim()));

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'RAW',
        requestBody: {
          values: rows,
        },
      });

      return `✅ Datos escritos correctamente en ${range}\nFilas: ${rows.length}\nColumnas: ${rows[0]?.length || 0}`;
    } catch (error) {
      return `Error escribiendo en hoja: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const appendSheetTool: Tool = {
  name: 'append_sheet',
  description: 'Añade filas al final de una hoja de Google Sheets',
  parameters: {
    type: 'object',
    properties: {
      spreadsheet_id: {
        type: 'string',
        description: 'ID del spreadsheet (de la URL)',
      },
      sheet_name: {
        type: 'string',
        description: 'Nombre de la hoja (ej: "Sheet1")',
      },
      values: {
        type: 'string',
        description: 'Datos separados por punto y coma para filas y coma para columnas',
      },
    },
    required: ['spreadsheet_id', 'sheet_name', 'values'],
  },
  execute: async (params, userId) => {
    const spreadsheetId = params.spreadsheet_id as string;
    const sheetName = params.sheet_name as string;
    const valuesStr = params.values as string;

    const sheets = await getSheetsClient(userId);
    if (!sheets) return AUTH_ERROR_MSG(userId);

    try {
      const rows = valuesStr.split(';').map(row => row.split(',').map(cell => cell.trim()));

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: rows,
        },
      });

      return `✅ ${rows.length} filas añadidas a ${sheetName}`;
    } catch (error) {
      return `Error añadiendo filas: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const createSheetTool: Tool = {
  name: 'create_sheet',
  description: 'Crea un nuevo Google Sheet',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Título del nuevo spreadsheet',
      },
    },
    required: ['title'],
  },
  execute: async (params, userId) => {
    const title = params.title as string;
    const sheets = await getSheetsClient(userId);
    if (!sheets) return AUTH_ERROR_MSG(userId);

    try {
      const response = await sheets.spreadsheets.create({
        requestBody: {
          properties: {
            title,
          },
        },
      });

      return `✅ Spreadsheet creado:\nTítulo: ${response.data.properties?.title}\nID: ${response.data.spreadsheetId}\nLink: ${response.data.spreadsheetUrl}`;
    } catch (error) {
      return `Error creando spreadsheet: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const listSheetsTool: Tool = {
  name: 'list_sheets_in_spreadsheet',
  description: 'Lista las hojas dentro de un spreadsheet',
  parameters: {
    type: 'object',
    properties: {
      spreadsheet_id: {
        type: 'string',
        description: 'ID del spreadsheet',
      },
    },
    required: ['spreadsheet_id'],
  },
  execute: async (params, userId) => {
    const spreadsheetId = params.spreadsheet_id as string;
    const sheets = await getSheetsClient(userId);
    if (!sheets) return AUTH_ERROR_MSG(userId);

    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
      });

      const sheetList = response.data.sheets?.map(s => `- ${s.properties?.title} (ID: ${s.properties?.sheetId})`).join('\n');
      return `Hojas en "${response.data.properties?.title}":\n\n${sheetList}`;
    } catch (error) {
      return `Error listando hojas: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
