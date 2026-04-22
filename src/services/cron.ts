import cron from 'node-cron';
import { Bot } from 'grammy';
import { runAgent } from '../agent/agent.js';
import { config } from '../config.js';

const TIMEZONE = 'Europe/Madrid';

export function setupCron(bot: Bot) {
  const schedule = config.cron.schedule;
  const targetUser = config.telegram.allowedUserIds[0];

  if (!targetUser) {
    console.warn('⚠️ No se ha configurado un usuario permitido para las tareas programadas.');
    return;
  }

  console.log(`⏰ Programando tarea diaria:  ${schedule}  (${TIMEZONE})`);

  cron.schedule(schedule, async () => {
    const now = new Date();
    const todayStr = now.toLocaleDateString('es-ES', {
      timeZone: TIMEZONE,
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
    console.log(`✨ Iniciando resumen ejecutivo diario (${todayStr})...`);

    try {
      const prompt = `TAREA EJECUTIVA CRÍTICA - RESUMEN DIARIO DE HOY (${todayStr}):

EJECUTA ESTAS HERRAMIENTAS AHORA MISMO:

1. list_events({ days_ahead: 1 }) 
   → IMPORTANTE: Debes listar los eventos de HOY.
2. read_email({ query: "is:unread", max_results: 5 })

UNA VEZ TENGAS LOS DATOS, genera un resumen profesional para el usuario con este formato:

🌟 *Buenos días, ${todayStr}*

📅 *Tu agenda de hoy:*
[Lista cada evento con su hora. Si no hay, di: "No hay eventos para hoy."]

📧 *Correos pendientes:*
[Lista los 5 más recientes. Si no hay: "Bandeja limpia ✅"]

💡 *Recomendación:* [Frase motivadora]

REGLA DE ORO: No digas "he revisado", MUESTRA los datos reales obtenidos de las herramientas.`;

      const result = await runAgent(targetUser, prompt);

      // Usamos parse_mode Markdown para el envío final
      await bot.api.sendMessage(targetUser, result.response, { parse_mode: 'Markdown' });
      
      console.log('✅ Resumen diario enviado con éxito.');
    } catch (error) {
      console.error('❌ Error en la tarea programada:', error);
    }
  }, { timezone: TIMEZONE });

}
