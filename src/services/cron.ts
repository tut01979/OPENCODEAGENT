import cron from 'node-cron';
import { Bot } from 'grammy';
import { runAgent } from '../agent/agent.js';
import { config } from '../config.js';

// Timezone para España (ajusta si es necesario)
const TIMEZONE = 'Europe/Madrid';

export function setupCron(bot: Bot) {
  const schedule = config.cron.schedule;
  const targetUser = config.telegram.allowedUserIds[0];

  if (!targetUser) {
    console.warn('⚠️ No se ha configurado un usuario permitido para las tareas programadas.');
    return;
  }

  console.log(`⏰ Programando tarea diaria: ${schedule} (${TIMEZONE})`);

  // Usar timezone explícito para España
  cron.schedule(schedule, async () => {
    const now = new Date().toLocaleString('es-ES', { timeZone: TIMEZONE });
    console.log(`✨ Iniciando resumen ejecutivo diario (${now})...`);

    try {
      const prompt = `ACTUACIÓN OBLIGATORIA - RESUMEN EJECUTIVO DIARIO:

EJECUTA ESTAS HERRAMIENTAS EN ORDEN (NO LAS SALTES):

1. **PRIMERO** - USA la herramienta "list_events" con estos parámetros exactos:
   - days_ahead: 1
   - Esto te dará los eventos de HOY del calendario de Google Calendar.

2. **SEGUNDO** - USA la herramienta "read_email" con estos parámetros:
   - query: "is:unread category:primary"
   - max_results: 5
   - Esto te dará los correos importantes sin leer.

3. **TERCERO** - Con los resultados REALES de las herramientas, genera un resumen ejecutivo.

 FORMATO DE RESPUESTA OBLIGATORIO:

🌟 **Buenos días, [fecha de hoy]**

📅 **Tu agenda de hoy:**
[Si hay eventos: lista cada uno con hora y título]
[Si NO hay eventos: "No tienes eventos programados para hoy"]

📧 **Correos pendientes:**
[Si hay correos: lista remitente y asunto de cada uno]
[Si NO hay correos: "Bandeja de entrada limpia"]

💡 **Recomendación del día:** [un consejo breve y motivador]

IMPORTANTE:
- USA LAS HERRAMIENTAS. No inventes eventos ni correos.
- Si una herramienta falla, indícalo claramente.
- Mantén el tono ejecutivo y profesional.`;

      const result = await runAgent(targetUser, prompt);

      await bot.api.sendMessage(targetUser, result.response, {
        parse_mode: 'Markdown'
      });
      console.log('✅ Resumen enviado con éxito.');
    } catch (error) {
      console.error('❌ Error en la tarea programada:', error);
    }
  }, {
    timezone: TIMEZONE
  });
}
