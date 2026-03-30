import { createBot } from './services/telegram.js';
import { memory } from './services/memory.js';
import { setupCron } from './services/cron.js';
import { startAuthServer } from './services/auth.js';

async function main() {
  console.log('🚀 Iniciando OPENCODEAGENT v1.3 (Voice: Enrique/Lucia)...');
  
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    startAuthServer(port);
    const bot = createBot();
    
    // Configurar tareas programadas
    setupCron(bot);

    // Manejo de cierre graceful
    const shutdown = async () => {
      console.log('\n🛑 Cerrando OPENCODEAGENT...');
      await bot.stop();
      memory.close();
      process.exit(0);
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    // Iniciar bot con long polling y limpiar mensajes pendientes
    console.log('✅ Bot conectado a Telegram');
    console.log('📡 Esperando mensajes...');
    
    const startBot = async () => {
      try {
        await bot.start({
          drop_pending_updates: true,
          onStart: () => console.log('🤖 OPENCODEAGENT está activo y sincronizado'),
        });
      } catch (error: any) {
        if (error.message?.includes('409: Conflict')) {
          console.warn('⚠️ Conflicto de instancia detectado. Reintentando en 5 segundos...');
          setTimeout(startBot, 5000);
        } else {
          console.error('❌ Error fatal en el bot:', error);
          process.exit(1);
        }
      }
    };

    await startBot();
  } catch (error) {
    console.error('❌ Error al inicializar:', error);
    process.exit(1);
  }
}

main();
