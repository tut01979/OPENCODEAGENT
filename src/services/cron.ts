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
      const prompt = `Buen día, aquí tienes tu resumen diario: 
      1. Revisa mis eventos del calendario de hoy.
      2. Revisa correos recibidos y facturas nuevas.
      3. Confirma archivos guardados en el Drive de la empresa.
      MUY IMPORTANTE: Tu respuesta DEBE ser en español con un tono ejecutivo y motivador: 
      'Buen día, aquí tienes tu resumen diario: tienes [X] eventos programados para hoy... a las 8:am gimnasio... a las 10:am proveedores... Estas son las facturas recibidas [de X y de Y] y ya están organizadas en tu Drive. Hoy es un gran día y vamos a sacarle partido. ¡Vamos!'`;
      
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
