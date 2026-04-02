import 'dotenv/config';

function getEnv(key: string, required = true): string {
  const value = process.env[key];
  if (required && (!value || value.includes('SUSTITUYE'))) {
    throw new Error(`Missing or placeholder env var: ${key}`);
  }
  return value || '';
}

function getEnvArray(key: string, required = true): string[] {
  const value = getEnv(key, required);
  return value ? value.split(',').map(s => s.trim()) : [];
}

export const config = {
  telegram: {
    botToken: getEnv('TELEGRAM_BOT_TOKEN'),
    botUsername: getEnv('TELEGRAM_BOT_USERNAME', false) || 'OPENCODE_AGENT_BOT',
    allowedUserIds: getEnvArray('TELEGRAM_ALLOWED_USER_IDS'),
    adminId: getEnv('ADMIN_TELEGRAM_ID', false) || getEnvArray('TELEGRAM_ALLOWED_USER_IDS')[0],
  },
  ollama: {
    baseUrl: getEnv('OLLAMA_BASE_URL', false) || 'http://localhost:11434',
    model: getEnv('OLLAMA_MODEL', false) || 'llama3.2',
  },
  groq: {
    apiKey: getEnv('GROQ_API_KEY'),
    model: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    apiKey: getEnv('OPENROUTER_API_KEY', false),
    model: getEnv('OPENROUTER_MODEL', false) || 'google/gemini-2.0-flash-001',
    textModel: getEnv('OPENROUTER_TEXT_MODEL', false) || 'google/gemini-2.0-flash-001',
  },
  db: {
    path: getEnv('DB_PATH', false) || './data/memory.db',
  },
  cron: {
    schedule: getEnv('CRON_SCHEDULE', false) || '30 6 * * *', // Por defecto 6:30 AM
  },
  firebase: {
    credentials: getEnv('GOOGLE_APPLICATION_CREDENTIALS', false) || './service-account.json',
    projectId: getEnv('FIREBASE_PROJECT_ID', false) || '',
  },
  agent: {
    maxIterations: 10,
    systemPrompt: `Eres OPENCODEAGENT v1.4, el asistente ejecutivo de Jesús Quintero Martínez, convertido ahora en una plataforma SaaS multi-usuario potente y comercial.

IDENTIDAD Y ENTORNO:
- Estás operando en TELEGRAM. Eres consciente de ello y puedes interactuar con los IDs de usuario de Telegram.
- Eres una IA Híbrida con acceso a herramientas de Google (Gmail, Calendar, Drive, Sheets) y capacidades de Visión y Voz.
- Tus respuestas deben ser profesionales, ejecutivas y proactivas.

REGLA DE SUSCRIPCIONES (SaaS):
- Si el usuario pregunta por precios, suscripciones o cómo usar el bot, explícale que tiene una PRUEBA GRATUITA de 7 días.
- Ofrece los dos planes disponibles:
  1. Plan MENSUAL: €10/mes.
  2. Plan ANUAL: €100/año (incluye 2 meses gratis).
- Para generar el enlace de pago, DEBES usar la herramienta 'get_subscription_link'.

REGLA CRÍTICA - HERRAMIENTAS OBLIGATORIAS:
Cuando el usuario pida emails, correos, calendario, eventos, Drive o Sheets, SIEMPRE debes llamar a la herramienta correspondiente. NUNCA respondas desde el historial o la memoria. Cada solicitud de datos de Google REQUIERE una llamada a herramienta en tiempo real.

REGLA PARA ERRORES:
Si una herramienta devuelve un error, CÓPIALO Y PÉGALO exactamente. No lo parafrasees ni digas "hay un problema técnico".

REGLA PARA GOOGLE OAUTH:
Si una herramienta devuelve un mensaje con 🔗, muéstralo COMPLETO e INMEDIATAMENTE sin modificar ni resumir el enlace.

REGLA DE PERSISTENCIA:
Si una operación falla, vuelve a intentarla llamando a la herramienta de nuevo. No te rindas con el primer intento.`,
  },
  gmail: {
    authMessage: (url: string) => `🔑 **ACCESO REQUERIDO** 🔑\n\nNo puedo leer tus correos porque el token ha caducado o no existe.\n\nAutoriza de nuevo aquí:\n🔗 ${url}\n\n(Si eres el admin, esto renovará el Token Maestro).`,
  },
  elevenlabs: {
    apiKey: getEnv('ELEVENLABS_API_KEY', false) || '',
  },
  voice: {
    // Voces TTSMP3 (Amazon Polly) en orden de prioridad
    // Se intentan en orden: si la primera falla, se prueba la siguiente
    fallbackVoices: (getEnv('VOICE_FALLBACK_LIST', false) || 'Lucia,Enrique,Conchita,Miguel,Penelope').split(',').map(s => s.trim()),
    // Voice IDs de ElevenLabs en orden de prioridad (obtenidos de tu cuenta)
    elevenlabsVoiceIds: (getEnv('ELEVENLABS_VOICE_IDS', false) || 'l1zE9xgNpUTaQCZzpNJa,8MeTTgXVwMEhRVfblXOj,6un5jIrLUaTPf56cFT5V').split(',').map(s => s.trim()),
    // Nombres descriptivos para los logs
    elevenlabsVoiceNames: (getEnv('ELEVENLABS_VOICE_NAMES', false) || 'Alberto Rodriguez,Carlos Aguilar,Nova').split(',').map(s => s.trim()),
  },
  payments: {
    stripeSecretKey: getEnv('STRIPE_SECRET_KEY', false),
    priceMonthly: getEnv('STRIPE_PRICE_MONTHLY', false),
    priceYearly: getEnv('STRIPE_PRICE_YEARLY', false),
    webhookSecret: getEnv('STRIPE_WEBHOOK_SECRET', false),
  },
} as const;
