import { Bot, InputFile } from 'grammy';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { runAgent, clearUserMemory } from '../agent/agent.js';
import { transcribeAudio } from '../tools/voiceTools.js';

// Almacenar usuarios que quieren respuestas en audio
const audioModeUsers = new Set<string>();

export function createBot(): Bot {
  const bot = new Bot(config.telegram.botToken);

  // Middleware de seguridad: verificar usuario permitido
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id.toString();
    
    if (!userId) {
      await ctx.reply('Error: No se pudo identificar tu usuario.');
      return;
    }

    if (!config.telegram.allowedUserIds.includes(userId)) {
      console.warn(`Usuario no autorizado intentó acceder: ${userId}`);
      await ctx.reply('⛔ No tienes permiso para usar este bot.');
      return;
    }

    await next();
  });

  // Comando /start
  bot.command('start', async (ctx) => {
    await ctx.reply(
      '💼 **¡Hola! Soy OpenCode, tu súper asistente ejecutivo.**\n\n' +
      'Estoy aquí para ser tu mano derecha. ¿Qué puedo hacer por ti hoy?\n\n' +
      'Comandos útiles:\n' +
      '/start - Mensaje de bienvenida\n' +
      '/help - Mis capacidades detalladas\n' +
      '/clear - Borrar historial de sesión\n' +
      '/voice - Alternar respuestas de voz',
      { parse_mode: 'Markdown' }
    );
  });

  // Comando /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '📖 **OpenCode - Tu Mano Derecha**\n\n' +
      'Como tu asistente ejecutivo, puedo encargarme de:\n\n' +
      '• 🕐 **Gestión de Tiempo**: Consultar la hora y zona horaria.\n' +
      '• 🔍 **Investigación**: Buscar cualquier dato en la web.\n' +
      '• 📁 **Documentación**: Leer y escribir archivos de todo tipo.\n' +
      '• 💻 **Soporte Técnico**: Ejecutar comandos y scripts.\n' +
      '• 📊 **Análisis de Datos**: Crear y leer tablas CSV para tu negocio.\n' +
      '• 📧 **Comunicaciones**: Leer, redactar y enviar emails por ti.\n' +
      '• 📅 **Agenda**: Crear, listar y gestionar tus reuniones en Google Calendar.\n' +
      '• ☁️ **Almacenamiento**: Subir y organizar tus documentos o fotos en Google Drive.\n' +
      '• 🎙️ **Voz y Audio**: Transcribir notas de voz y responderte hablando.\n\n' +
      'Solo dime qué necesitas y yo me ocupo.',
      { parse_mode: 'Markdown' }
    );
  });

  // Comando /clear
  bot.command('clear', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    clearUserMemory(userId);
    await ctx.reply('🗑️ Historial de conversación borrado.');
  });

  // Comando /voice - activar/desactivar modo audio
  bot.command('voice', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    
    if (audioModeUsers.has(userId)) {
      audioModeUsers.delete(userId);
      await ctx.reply('🔇 Modo audio desactivado. Ahora responderé con texto.');
    } else {
      audioModeUsers.add(userId);
      await ctx.reply('🔊 Modo audio activado. Ahora responderé con notas de voz.');
    }
  });

  // Manejar mensajes de voz
  bot.on('message:voice', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    await ctx.replyWithChatAction('typing');
    await ctx.reply('🎤 Transcribiendo audio...');

    try {
      const voice = ctx.message.voice;
      const transcription = await transcribeAudio(voice.file_id, config.telegram.botToken);
      
      if (transcription.startsWith('⚠️') || transcription.startsWith('Error')) {
        await ctx.reply(transcription);
        return;
      }

      await ctx.reply(`📝 Transcripción: "${transcription}"`);
      await ctx.replyWithChatAction('typing');

      // Procesar con el agente
      const result = await runAgent(userId, transcription);
      
      // Responder en audio (siempre para notas de voz)
      const audioUsers = true;
      await ctx.replyWithChatAction('record_voice');
      
      const audioResponse = audioUsers ? await generateAudio(result.response) : null;
      if (audioResponse) {
        await ctx.replyWithVoice(new InputFile(audioResponse));
        fs.unlinkSync(audioResponse);
      } else {
        await sendLongMessage(ctx, result.response);
      }
    } catch (error) {
      console.error('Error procesando audio:', error);
      await ctx.reply('❌ Error procesando el audio. Inténtalo de nuevo.');
    }
  });

  // Manejar mensajes de texto
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    
    const userMessage = ctx.message.text;

    // Ignorar comandos
    if (userMessage.startsWith('/')) return;

    // Indicador de escritura
    await ctx.replyWithChatAction('typing');

    try {
      const result = await runAgent(userId, userMessage);
      
      // Si el usuario tiene modo audio activado, responder con voz
      if (audioModeUsers.has(userId) && config.elevenlabs.apiKey) {
        await ctx.replyWithChatAction('record_voice');
        const audioResponse = await generateAudio(result.response);
        if (audioResponse) {
          await ctx.replyWithVoice(new InputFile(audioResponse));
          fs.unlinkSync(audioResponse);
        } else {
          await sendLongMessage(ctx, result.response);
        }
      } else {
        await sendLongMessage(ctx, result.response);
      }
    } catch (error) {
      console.error('Error procesando mensaje:', error);
      await ctx.reply('❌ Ocurrió un error procesando tu mensaje. Inténtalo de nuevo.');
    }
  });

  // Manejar documentos subidos
  bot.on('message:document', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const document = ctx.message.document;
    const fileName = document.file_name || `file_${Date.now()}`;
    
    await ctx.reply(`📎 Recibido: ${fileName}\n⏳ Descargando...`);
    
    try {
      const file = await ctx.api.getFile(document.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
      
      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      
      const savePath = path.resolve(`./uploads/${fileName}`);
      const dir = path.dirname(savePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(savePath, Buffer.from(buffer));
      
      let textContent = '';
      const ext = fileName.toLowerCase().split('.').pop();
      const textExtensions = ['txt', 'md', 'ts', 'js', 'json', 'py', 'java', 'c', 'cpp', 'html', 'css', 'csv'];

      if (ext === 'pdf') {
        try {
          const { PDFParse } = await import('pdf-parse');
          const parser = new PDFParse({ data: Buffer.from(buffer) });
          const data = await parser.getText();
          textContent = data.text;
          console.log(`📎 PDF extraído: ${fileName}`);
          console.log(`🔤 Caracteres: ${textContent.length}`);
        } catch (err) {
          console.error('Error parseando PDF:', err);
          textContent = 'No se pudo leer el contenido del PDF automáticamente.';
        }
      } else if (textExtensions.includes(ext || '')) {
        textContent = fs.readFileSync(savePath, 'utf-8');
        console.log(`📎 Archivo de texto/código: ${fileName} (${textContent.length} caracteres)`);
      } else {
        // Intentar leer como texto si es pequeño
        if (buffer.byteLength < 500000) { // < 500KB
          textContent = fs.readFileSync(savePath, 'utf-8');
          console.log(`📎 Archivo desconocido leído como texto: ${fileName} (${textContent.length} caracteres)`);
        } else {
          textContent = '[Archivo binario o demasiado grande para análisis de texto directo]';
        }
      }

      await ctx.replyWithChatAction('typing');
      await ctx.reply(`✅ Archivo guardado: ./uploads/${fileName}\n\n🔍 Analizando contenido (${textContent.length} caracteres)...`);
      
      // Procesar el archivo con el agente
      const prompt = `Analiza este archivo llamado "${fileName}". El contenido es:\n\n${textContent.slice(0, 30000)}`;
      
      const result = await runAgent(userId, prompt);
      await sendLongMessage(ctx, result.response);
      
    } catch (error) {
      console.error('Error procesando archivo:', error);
      await ctx.reply(`✅ Archivo guardado en: ./uploads/${fileName}\n\n⚠️ No pude analizar el contenido automáticamente. Dime "Lee el archivo ./uploads/${fileName}" y lo leeré.`);
    }
  });

  // Manejar fotos
  bot.on('message:photo', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1]; // La más grande
    
    await ctx.reply('📷 Foto recibida. Analizando...');
    await ctx.replyWithChatAction('typing');
    
    try {
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
      
      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      const base64Image = Buffer.from(buffer).toString('base64');
      
      const prompt = [
        { type: 'text', text: ctx.message?.caption || '¿Qué ves en esta imagen?' },
        { 
          type: 'image_url', 
          image_url: { 
            url: `data:image/jpeg;base64,${base64Image}` 
          } 
        }
      ];
      
      const result = await runAgent(userId, prompt);
      await sendLongMessage(ctx, result.response);
      
    } catch (error) {
      console.error('Error procesando foto:', error);
      await ctx.reply('📷 Foto recibida. ¿Qué quieres saber sobre ella?');
    }
  });

  return bot;
}

function cleanTextForSpeech(text: string): string {
  if (!text) return '';
  
  // 1. Eliminar bloques de código por completo (suelen ser aburridos de oír)
  let cleaned = text.replace(/```[\s\S]*?```/g, ' [código omitido] ');
  
  // 2. Eliminar tablas markdown
  cleaned = cleaned.replace(/\|[\s\S]*?\|/g, ' ');
  
  // 3. Eliminar enlaces y mantener solo el texto
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // 4. Eliminar TODOS los símbolos markdown comunes (*, _, #, -, >, `)
  cleaned = cleaned.replace(/[*_#\-<>`~]/g, ' ');
  
  // 5. Eliminar emojis (algunos TTS intentan leerlos por nombre)
  cleaned = cleaned.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

  // 6. Eliminar múltiples espacios y saltos de línea
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // 7. Asegurar puntuación básica para pausas naturales
  // No necesitamos hacer mucho aquí, solo evitar que queden caracteres sueltos
  cleaned = cleaned.replace(/\s+([.,!?;:])/g, '$1');

  return cleaned;
}

async function sendLongMessage(ctx: any, message: string): Promise<void> {
  const maxLength = 4000;
  if (message.length <= maxLength) {
    await ctx.reply(message);
  } else {
    const parts = [];
    for (let i = 0; i < message.length; i += maxLength) {
      parts.push(message.slice(i, i + maxLength));
    }
    for (const part of parts) {
      await ctx.reply(part);
    }
  }
}

// Cache para evitar reintentar ElevenLabs si la API key es inválida
let elevenlabsDisabled = false;
let elevenlabsDisabledUntil = 0;

async function generateAudio(text: string): Promise<string | null> {
  const speechText = cleanTextForSpeech(text);
  const truncatedText = speechText.length > 2000 ? speechText.slice(0, 2000) + '...' : speechText;
  
  if (!truncatedText) return null;
  
  const outputPath = path.resolve(`./temp_voice_${Date.now()}.mp3`);
  
  // ═══════════════════════════════════════════════════════════════
  // NIVEL 1: TTSMP3 (Amazon Polly) — GRATIS e ILIMITADO
  // Orden por defecto: Lucia → Enrique → Conchita → Miguel → Penelope
  // ═══════════════════════════════════════════════════════════════
  const pollyVoices = config.voice.fallbackVoices;

  for (let i = 0; i < pollyVoices.length; i++) {
    const speaker = pollyVoices[i];
    try {
      console.log(`🎙️ TTSMP3: Intentando voz "${speaker}"... [${i + 1}/${pollyVoices.length}]`);
      const postBody = new URLSearchParams({
        msg: truncatedText,
        lang: speaker,
        source: 'ttsmp3'
      });

      const postRes = await fetch('https://ttsmp3.com/makemp3_new.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: postBody.toString()
      });

      if (postRes.ok) {
        const data: any = await postRes.json();
        if (data.Error === 0 && data.URL) {
          const audioRes = await fetch(data.URL);
          if (audioRes.ok) {
            const arrayBuffer = await audioRes.arrayBuffer();
            fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
            console.log(`✅ TTSMP3: Voz "${speaker}" generada con éxito.`);
            return outputPath;
          }
          console.warn(`⚠️ TTSMP3: La descarga del audio de "${speaker}" falló. Probando siguiente...`);
        } else {
          console.warn(`⚠️ TTSMP3: Voz "${speaker}" devolvió error: ${data.Error_msg || 'desconocido'}. Probando siguiente...`);
        }
      } else {
        console.warn(`⚠️ TTSMP3: Voz "${speaker}" falló (HTTP ${postRes.status}). Probando siguiente...`);
      }
    } catch (error) {
      console.warn(`⚠️ TTSMP3: Error con voz "${speaker}":`, error instanceof Error ? error.message : error);
    }
  }
  // ═══════════════════════════════════════════════════════════════
  // NIVEL 2: Google TTS (Estable, calidad media, GRATIS)
  // ═══════════════════════════════════════════════════════════════
  try {
    console.log('🎙️ Google TTS: Intentando...');
    // @ts-ignore
    const googleTTS = await import('google-tts-api');
    
    // getAllAudioBase64 divide automáticamente el texto si es largo (> 200 chars)
    const results = await googleTTS.getAllAudioBase64(truncatedText, {
      lang: 'es-ES',
      slow: false,
      host: 'https://translate.google.com',
    });
    
    // Concatenar todos los buffers base64
    const buffers = results.map((r: any) => Buffer.from(r.base64, 'base64'));
    fs.writeFileSync(outputPath, Buffer.concat(buffers));
    
    console.log('✅ Google TTS: Audio generado con éxito.');
    return outputPath;
  } catch (error) {
    console.warn('⚠️ Google TTS: Error:', error instanceof Error ? error.message : error);
  }

  // ═══════════════════════════════════════════════════════════════
  // NIVEL 3: ElevenLabs (Calidad Premium) — CRÉDITOS LIMITADOS
  // Solo se usa si las opciones gratuitas fallaron. 
  // Voces: Alberto Rodriguez → Carlos Aguilar → Nova
  // ═══════════════════════════════════════════════════════════════
  if (config.elevenlabs.apiKey && !elevenlabsDisabled) {
    const voiceIds = config.voice.elevenlabsVoiceIds;
    const voiceNames = config.voice.elevenlabsVoiceNames;

    for (let i = 0; i < voiceIds.length; i++) {
      const voiceId = voiceIds[i];
      const voiceName = voiceNames[i] || `Voice-${i + 1}`;
      try {
        console.log(`🎙️ ElevenLabs: Intentando voz "${voiceName}" (${voiceId})... [${i + 1}/${voiceIds.length}]`);
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': config.elevenlabs.apiKey,
          },
          body: JSON.stringify({
            text: truncatedText,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        });

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
          console.log(`✅ ElevenLabs: Voz "${voiceName}" generada con éxito.`);
          return outputPath;
        }
        
        const status = response.status;
        
        // CIRCUIT BREAKER: Si 401 (API key inválida), desactivar ElevenLabs por 1 hora
        if (status === 401) {
          console.warn(`🔒 ElevenLabs: API key inválida/expirada (HTTP 401). Desactivando por 1 hora.`);
          elevenlabsDisabled = true;
          elevenlabsDisabledUntil = Date.now() + 3600000;
          setTimeout(() => { elevenlabsDisabled = false; }, 3600000);
          break;
        }
        
        // Si 429 (rate limit/créditos agotados), saltar el resto
        if (status === 429) {
          console.warn(`⚠️ ElevenLabs: Créditos agotados o rate limit (HTTP 429). Saltando...`);
          break;
        }
        
        console.warn(`⚠️ ElevenLabs: Voz "${voiceName}" falló (HTTP ${status}). Probando siguiente...`);
      } catch (error) {
        console.warn(`⚠️ ElevenLabs: Error con voz "${voiceName}":`, error instanceof Error ? error.message : error);
      }
    }
    if (!elevenlabsDisabled) {
      console.warn('❌ ElevenLabs: Todas las voces fallaron. Pasando a voz robótica...');
    }
  } else if (elevenlabsDisabled) {
    console.log('🔒 ElevenLabs: Desactivado temporalmente. Saltando...');
  }

  // ═══════════════════════════════════════════════════════════════
  // NIVEL 4: node-gtts (Voz robótica — Último recurso)
  // ═══════════════════════════════════════════════════════════════
  try {
    console.log('🤖 node-gtts: Último recurso (voz robótica)...');
    const gttsImport = await import('node-gtts');
    const Gtts = (gttsImport as any).default || gttsImport;
    const gtts = new (Gtts as any)('es');
    
    return new Promise((resolve) => {
      gtts.save(outputPath, truncatedText, (err: any) => {
        if (err) {
          console.error('❌ node-gtts también falló. Sin audio disponible.');
          resolve(null);
        } else {
          console.log('✅ node-gtts: Voz robótica generada como último recurso.');
          resolve(outputPath);
        }
      });
    });
  } catch (error) {
    console.error('❌ Ningún proveedor de voz funcionó:', error instanceof Error ? error.message : error);
    return null;
  }
}

