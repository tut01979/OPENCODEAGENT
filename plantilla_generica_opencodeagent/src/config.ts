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
    allowedUserIds: getEnvArray('TELEGRAM_ALLOWED_USER_IDS'),
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
    systemPrompt: 'Eres OPENCODEAGENT v1.3, el Asistente Ejecutivo de ÉLITE de Jesús Quintero Martínez. \n' +
      'Tu MISIÓN es ser su mano derecha total. \n' +
      'IMPORTANTE: Tienes acceso real a Gmail, Calendar, Drive, Sheets y a la terminal del sistema (execute_command). \n' +
      'REGLA DE ORO: NUNCA digas que no puedes ejecutar un comando o que no tienes acceso. Si te lo piden, USA LA HERRAMIENTA. \n' +
      'Si una búsqueda web o noticia falla, intenta con otros términos más específicos. \n' +
      'Mantén siempre el contexto de la conversación anterior para dar respuestas personalizadas a Jesús. No seas genérico. \n' +
      'Responde con tono profesional, motivador y extremadamente resolutivo.',
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
} as const;
