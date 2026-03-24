import fs from 'fs/promises';
import path from 'path';
import type { Tool } from './types.js';

export const createCSVTool: Tool = {
  name: 'create_csv',
  description: 'Crea una tabla en formato CSV',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Nombre del archivo CSV (con extensión .csv)',
      },
      headers: {
        type: 'string',
        description: 'Cabeceras separadas por coma (ej: "Nombre,Edad,Ciudad")',
      },
      rows: {
        type: 'string',
        description: 'Filas separadas por punto y coma, y valores por coma (ej: "Juan,25,Madrid;Ana,30,Barcelona")',
      },
    },
    required: ['filename', 'headers', 'rows'],
  },
  execute: async (params) => {
    const filename = params.filename as string;
    const headers = params.headers as string;
    const rows = params.rows as string;
    
    try {
      // Validar nombre de archivo
      if (!filename.endsWith('.csv')) {
        return 'Error: El archivo debe terminar en .csv';
      }
      
      // Construir CSV
      let csv = headers + '\n';
      
      const rowArray = rows.split(';');
      for (const row of rowArray) {
        const values = row.split(',');
        csv += values.map(v => v.trim()).join(',') + '\n';
      }
      
      // Guardar archivo
      const absolutePath = path.resolve(filename);
      await fs.writeFile(absolutePath, csv, 'utf-8');
      
      return `Tabla CSV creada correctamente:\n\n${csv}\nGuardada en: ${absolutePath}`;
    } catch (error) {
      return `Error creando CSV: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const readCSVTool: Tool = {
  name: 'read_csv',
  description: 'Lee y muestra una tabla CSV',
  parameters: {
    type: 'object',
    properties: {
      filename: {
        type: 'string',
        description: 'Ruta del archivo CSV',
      },
    },
    required: ['filename'],
  },
  execute: async (params) => {
    const filename = params.filename as string;
    
    try {
      const absolutePath = path.resolve(filename);
      const content = await fs.readFile(absolutePath, 'utf-8');
      
      const lines = content.trim().split('\n');
      if (lines.length === 0) {
        return 'El archivo CSV está vacío';
      }
      
      const headers = lines[0].split(',');
      const rows = lines.slice(1).map(line => line.split(','));
      
      // Formatear como tabla
      let table = `Cabeceras: ${headers.join(' | ')}\n`;
      table += '-'.repeat(50) + '\n';
      
      for (let i = 0; i < rows.length; i++) {
        table += `Fila ${i + 1}: ${rows[i].join(' | ')}\n`;
      }
      
      return table;
    } catch (error) {
      return `Error leyendo CSV: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
