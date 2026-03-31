import { exec } from 'child_process';
import { promisify } from 'util';
import type { Tool } from './types.js';

const execAsync = promisify(exec);

export const executeCommandTool: Tool = {
  name: 'execute_command',
  description: 'Ejecuta un comando en el sistema (shell). CUIDADO: Comandos peligrosos como rm -rf / están prohibidos.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Comando a ejecutar',
      },
      timeout: {
        type: 'number',
        description: 'Timeout en milisegundos (default: 30000)',
      },
    },
    required: ['command'],
  },
  execute: async (params, userId) => {
    // 🛡️ CIBERSEGURIDAD SAAS: Solo el Administrador puede ejecutar comandos en Railway
    const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;
    if (!ADMIN_TELEGRAM_ID || userId !== ADMIN_TELEGRAM_ID) {
      return `❌ ACCESO DENEGADO: La herramienta de Terminal del sistema está desactivada por motivos de ciberseguridad. Ejecutar comandos remotos es un riesgo en un entorno SaaS. Contacte con el administrador.`;
    }

    const command = params.command as string;
    const timeout = (params.timeout as number) || 30000;
    
    // Lista de comandos prohibidos
    const forbidden = [
      'rm -rf /',
      'rm -rf /*',
      'mkfs',
      'dd if=',
      ':(){:|:&};:',
      'chmod -R 777 /',
      'shutdown',
      'reboot',
      'init 0',
      'halt',
    ];
    
    const commandLower = command.toLowerCase();
    for (const bad of forbidden) {
      if (commandLower.includes(bad.toLowerCase())) {
        return `⚠️ Comando prohibido por seguridad: ${bad}`;
      }
    }
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout,
        maxBuffer: 1024 * 1024, // 1MB max output
      });
      
      let result = '';
      if (stdout) result += `STDOUT:\n${stdout}`;
      if (stderr) result += `\nSTDERR:\n${stderr}`;
      
      return result || 'Comando ejecutado sin salida';
    } catch (error) {
      const err = error as { message: string; stdout?: string; stderr?: string };
      return `Error ejecutando comando: ${err.message}\n${err.stderr || ''}`;
    }
  },
};
