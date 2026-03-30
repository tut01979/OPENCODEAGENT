import cron from 'node-cron';
import { Bot } from 'grammy';
import { runAgent } from '../agent/agent.js';
import { config } from '../config.js';

export function setupCron(bot: Bot) {
  const schedule = config.cron.schedule;
  const targetUser = config.telegram.allowedUserIds[0];

  if (!targetUser) {
    console.warn('⚠️ No se ha configurado un usuario permitido para las tareas programadas.');
    return;
  }

  console.log(`⏰ Programando tarea diaria: ${schedule}`);

  cron.schedule(schedule, async () => {
    console.log('✨ Iniciando resumen ejecutivo diario...');
    try {
      const prompt = `EJECUTA ESTAS TAREAS EN ORDEN USANDO LAS HERRAMIENTAS:

1. USA la herramienta "list_events" con days_ahead=1 para obtener los eventos de HOY del calendario de Google.
2. USA la herramienta "read_email" con query="is:unread" y max_results=5 para ver los correos sin leer.

IMPORTANTE: DEBES usar las herramientas list_events y read_email. No inventes eventos ni correos.

Luego responde en español con tono ejecutivo y motivador: "Buen día, aquí tienes tu resumen diario: tienes [X] eventos programados para hoy... [lista los eventos con hora]... Tienes [Y] correos sin leer: [de quién y sobre qué]... ¡Hoy es un gran día!"`;
      
      const result = await runAgent(targetUser, prompt);
      
      await bot.api.sendMessage(targetUser, `🌟 **Resumen Ejecutivo Diario** 🌟\n\n${result.response}`, {
        parse_mode: 'Markdown'
      });
      console.log('✅ Resumen enviado con éxito.');
    } catch (error) {
      console.error('❌ Error en la tarea programada:', error);
    }
  });
}
