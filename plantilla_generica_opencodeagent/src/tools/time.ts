import type { Tool } from './types.js';

export const getCurrentTimeTool: Tool = {
  name: 'get_current_time',
  description: 'Obtiene la fecha y hora actual',
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'Zona horaria (ej: Europe/Madrid, America/New_York). Por defecto UTC.',
      },
    },
    required: [],
  },
  execute: (params) => {
    const timezone = (params.timezone as string) || 'UTC';
    const now = new Date();
    try {
      return now.toLocaleString('es-ES', { timeZone: timezone });
    } catch {
      return now.toLocaleString('es-ES', { timeZone: 'UTC' }) + ` (timezone ${timezone} no válida, mostrando UTC)`;
    }
  },
};
