import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import type { Tool } from './types.js';

const TOKEN_PATH = './token.json';
const CREDENTIALS_PATH = './gmail-credentials.json';

import { config } from '../config.js';

async function getSheetsClient() {
  // 1. PRIORIDAD: OAuth2 (Acceso personal del usuario)
  try {
    if (fs.existsSync(TOKEN_PATH) && fs.existsSync(CREDENTIALS_PATH)) {
      const credentialsContent = fs.readFileSync(path.resolve(CREDENTIALS_PATH), 'utf-8');
      const credentials = JSON.parse(credentialsContent);
      const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;
      const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
      
      const tokenContent = fs.readFileSync(path.resolve(TOKEN_PATH), 'utf-8');
      oAuth2Client.setCredentials(JSON.parse(tokenContent));
      return google.sheets({ version: 'v4', auth: oAuth2Client });
    }
  } catch (err) {
    console.warn('Fallo OAuth2 en Sheets:', err);
  }

  // 2. FALLBACK: Service Account
  try {
    const creds = config.firebase.credentials;
    const credentialsPath = path.isAbsolute(creds) ? creds : path.join(process.cwd(), creds);
    if (fs.existsSync(credentialsPath)) {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      const authClient = await auth.getClient();
      return google.sheets({ version: 'v4', auth: authClient as any });
    }
  } catch (err) {
    console.warn('Fallo Service Account en Sheets:', err);
  }

  return null;
}

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
  execute: async (params) => {
    const spreadsheetId = params.spreadsheet_id as string;
    const range = params.range as string;
    
    const sheets = await getSheetsClient();
    if (!sheets) {
      return '⚠️ Google Sheets no configurado. Necesitas configurar OAuth2 primero.';
    }
    
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
  execute: async (params) => {
    const spreadsheetId = params.spreadsheet_id as string;
    const range = params.range as string;
    const valuesStr = params.values as string;
    
    const sheets = await getSheetsClient();
    if (!sheets) {
      return '⚠️ Google Sheets no configurado. Necesitas configurar OAuth2 primero.';
    }
    
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
  execute: async (params) => {
    const spreadsheetId = params.spreadsheet_id as string;
    const sheetName = params.sheet_name as string;
    const valuesStr = params.values as string;
    
    const sheets = await getSheetsClient();
    if (!sheets) {
      return '⚠️ Google Sheets no configurado.';
    }
    
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
  execute: async (params) => {
    const title = params.title as string;
    
    const sheets = await getSheetsClient();
    if (!sheets) {
      return '⚠️ Google Sheets no configurado.';
    }
    
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
  execute: async (params) => {
    const spreadsheetId = params.spreadsheet_id as string;
    
    const sheets = await getSheetsClient();
    if (!sheets) {
      return '⚠️ Google Sheets no configurado.';
    }
    
    try {
      const response = await sheets.spreadsheets.get({
        spreadsheetId,
      });
      
      const sheetList = response.data.sheets?.map(s => 
        `- ${s.properties?.title} (ID: ${s.properties?.sheetId})`
      ).join('\n');
      
      return `Hojas en "${response.data.properties?.title}":\n\n${sheetList}`;
    } catch (error) {
      return `Error listando hojas: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
