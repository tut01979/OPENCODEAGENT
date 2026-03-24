import fs from 'fs/promises';
import path from 'path';
import type { Tool } from './types.js';

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Lee el contenido de un archivo',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del archivo a leer',
      },
    },
    required: ['path'],
  },
  execute: async (params) => {
    const filePath = params.path as string;
    
    try {
      const absolutePath = path.resolve(filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      
      // Limitar tamaño para evitar sobrecarga
      if (content.length > 50000) {
        return `Archivo muy grande (${content.length} chars). Primeros 50000 caracteres:\n\n${content.slice(0, 50000)}\n\n[... truncado]`;
      }
      
      return content;
    } catch (error) {
      return `Error leyendo archivo: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Escribe contenido a un archivo',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Ruta del archivo a escribir',
      },
      content: {
        type: 'string',
        description: 'Contenido a escribir',
      },
    },
    required: ['path', 'content'],
  },
  execute: async (params) => {
    const filePath = params.path as string;
    const content = params.content as string;
    
    try {
      const absolutePath = path.resolve(filePath);
      const dir = path.dirname(absolutePath);
      
      // Crear directorio si no existe
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(absolutePath, content, 'utf-8');
      
      return `Archivo escrito correctamente: ${absolutePath}`;
    } catch (error) {
      return `Error escribiendo archivo: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};
