import 'dotenv/config';
import { getMainSystemPrompt } from './prompts/mainSystemPrompt.js';

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
    botUsername: getEnv('TELEGRAM_BOT_USERNAME', false) || 'OPENCODEAGENT_BOT',
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
    getSystemPrompt: () => getMainSystemPrompt(),
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
    awsAccessKey: getEnv('AWS_ACCESS_KEY_ID', false) || '',
    awsSecretKey: getEnv('AWS_SECRET_ACCESS_KEY', false) || '',
    awsRegion: getEnv('AWS_REGION', false) || 'us-east-1',
    pollyVoice: getEnv('AWS_POLLY_VOICE', false) || 'Lucia',
  },
  payments: {
    stripeSecretKey: getEnv('STRIPE_SECRET_KEY', false),
    priceMonthly: getEnv('STRIPE_PRICE_MONTHLY', false),
    priceYearly: getEnv('STRIPE_PRICE_YEARLY', false),
    webhookSecret: getEnv('STRIPE_WEBHOOK_SECRET', false),
  },
  brave: {
    apiKey: getEnv('BRAVE_SEARCH_API_KEY', false) || '',
  },
} as const;
