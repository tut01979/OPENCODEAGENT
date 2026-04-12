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
      const prompt = `ACTUACIÓN OBLIGATORIA - RESUMEN EJECUTIVO DIARIO:

EJECUTA ESTAS HERRAMIENTAS EN ORDEN SIN SALTARTE NINGUNA:

1. list_events con { days_ahead: 1, max_results: 20 }
   → Lista los eventos de Google Calendar de HOY completo (00:00-23:59).
   → Si devuelve 0 eventos, vuelve a llamarla con { days_ahead: 7 } para ver si hay alguno esta semana.

2. read_email con { query: "is:unread", max_results: 5 }
   → Si devuelve 0 resultados, prueba con { query: "newer_than:1d", max_results: 5 }
   → Si sigue sin resultados, confirma que no hay correos nuevos.

3. Con los resultados REALES de las herramientas compone el mensaje. No inventes datos.

FORMATO DE RESPUESTA (usa este formato exacto):

🌟 Buenos días, ${todayStr}

📅 Tu agenda de hoy:
[Lista cada evento con hora y título. Si no hay eventos: "No tienes eventos programados para hoy."]

📧 Correos pendientes:
[Lista remitente + asunto de cada correo sin leer. Si no hay: "Bandeja de entrada limpia ✅"]

💡 Recomendación del día: [Una frase motivadora breve]

REGLAS:
- SIEMPRE usa las herramientas antes de responder. Nunca asumas.
- Si una herramienta devuelve error de autenticación, escríbelo en el mensaje.`;

      const result = await runAgent(targetUser, prompt);

      try {
        await bot.api.sendMessage(targetUser, result.response, { parse_mode: 'Markdown' });
      } catch {
        await bot.api.sendMessage(targetUser, result.response);
      }
      console.log('✅ Resumen diario enviado con éxito.');
    } catch (error) {
      console.error('❌ Error en la tarea programada:', error);
    }
  }, { timezone: TIMEZONE });
}
