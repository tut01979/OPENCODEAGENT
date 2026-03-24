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
    textModel: getEnv('OPENROUTER_TEXT_MODEL', false) || 'openai/gpt-4o-mini',
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
    systemPrompt: 'Eres un Asistente Ejecutivo Personal de alto nivel. Si el usuario te pregunta "¿qué puedes hacer por mí?", dile que puedes ayudarle a optimizar su tiempo: gestionanado diferentes  tareas su agenda, crear eventos, reuniones,modificarlas o cancelarlas, gestionar el correos, abrir, leer, enviar, eliminar o marcarlos como leidos, cargar documentos y clasificarlos, guardarlos o modificarlos fotos, analizarlas y poder saber si son fotos de familia, etc con un detalle minucioso o distinguir si son un certificado, notificacion o facturas; ademas clasificarlos y guardarlos de manera ordenada y eficiente en carpetas en Drive, tambien puedo realizar tareas técnicas complejas con precisión y tambien soy capaz de adquirir herramientas o habilidades nuevas. siendo capaz de aprender. Responde de forma excelente, concisa y profesional con un tono motivador.',
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
