// -*- coding: utf-8 -*-
import { Bot, InputFile } from 'grammy';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { runAgent, clearUserMemory } from '../agent/agent.js';
import { transcribeAudio } from '../tools/voiceTools.js';
import { payments } from './payments.js';
import { firebase } from './firebase.js';
import { cleanTextForSpeech } from '../utils/sanitize.js';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { getDriveClient } from '../tools/driveTools.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Almacenar usuarios que quieren respuestas en audio
const audioModeUsers = new Set<string>();

// 📂 Directorios de trabajo
const VERSION = 'v1.4.1 (Stable)';
const TEMP_DIR = '/app/temp';
if (!fs.existsSync(TEMP_DIR)) {
  console.log(`📁 Creando directorio temporal en: ${TEMP_DIR}`);
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  } catch (err) {
    console.error(`❌ No se pudo crear ${TEMP_DIR}, usando fallback local:`, err);
  }
}

const UPLOADS_DIR = path.resolve('./uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export function createBot(): Bot {
  const bot = new Bot(config.telegram.botToken);

  // Middleware de seguridad: verificar usuario permitido
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id.toString();

    if (!userId) {
      await ctx.reply('Error: No se pudo identificar tu usuario.');
      return;
    }

    // 🔓 MODO SAAS ACTIVADO: Se elimina el bloqueo de usuarios.
    // Ahora cualquier persona puede interactuar con el bot y enlazar su cuenta de Google.
    // if (!config.telegram.allowedUserIds.includes(userId)) { ... }

    await next();
  });

  // Comando /start
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (userId) {
      // Forzar inicialización de periodo de prueba si es nuevo
      await payments.isSubscriptionActive(userId);
      // Reiniciar contador de interacciones para nuevos usuarios
      await firebase.updateUserData(userId, { interactionCount: 0 });
    }

    await ctx.reply(
      '¡Hola! 👋\n\n' +
      'Soy OpenCodeAgent v1.4, tu Ejecutivo IA Híbrido.\n\n' +
      'No soy solo un chatbot. Estoy diseñado para **hacer el trabajo ejecutivo** por ti y gestionar tus tareas diarias de forma ultrarrápida directamente desde Telegram.\n\n' +
      'Puedo revisar tu correo, crear reuniones en Calendar, organizar Drive, analizar documentos y mucho más.\n\n' +
      '✅ **Prueba Gratis de 7 días activada**\n\n' +
      'Dime qué necesitas hoy, por ejemplo:\n' +
      '• "Revisa mi correo y hazme un resumen ejecutivo"\n' +
      '• "Crea una reunión mañana a las 11 con el inversor"\n' +
      '• "Analiza esta captura de pantalla"\n\n' +
      'Estoy listo para trabajar. ¿Qué hacemos? 🚀',
      { parse_mode: 'Markdown' }
    );
  });

  // Comando /status
  bot.command('status', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    await ctx.replyWithChatAction('typing');
    const isActive = await payments.isSubscriptionActive(userId);
    const userData = await firebase.getUserData(userId);

    let message = '📊 **TU ESTADO EN OPENCODEAGENT**\n\n';

    if (userId === config.telegram.adminId) {
      message += '👑 **MODO ADMINISTRADOR**: Acceso vitalicio ilimitado.';
    } else if (userData?.subscription_status === 'active') {
      message += '✅ **SUSCRIPCIÓN ACTIVA**: Tienes acceso completo.';
    } else if (userData?.trial_ends_at) {
      const remainingDays = Math.ceil((userData.trial_ends_at - Date.now()) / (1000 * 60 * 60 * 24));
      if (remainingDays > 0) {
        message += `🎁 **PERIODO DE PRUEBA**: Te quedan **${remainingDays} días**.`;
      } else {
        message += '❌ **PRUEBA TERMINADA**: Suscríbete para continuar.';
      }
    } else {
      message += '❓ **SIN ESTADO**: Escribe algo para iniciar tu prueba.';
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  });

  // Comando /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '📖 **OpenCode - Tu Mano Derecha Multi-Canal**\n\n' +
      'Como tu asistente ejecutivo IA, puedo encargarme de:\n\n' +
      '• 📧 **Comunicaciones**: Leer, redactar y enviar emails (Gmail).\n' +
      '• 📅 **Agenda**: Gestionar tus reuniones en Google Calendar.\n' +
      '• ☁️ **Drive**: Subir y organizar documentos en Google Drive.\n' +
      '• 🎙️ **Voz**: Transcribir audios y responderte hablando.\n' +
      '• 🔍 **Web**: Investigar datos en tiempo real.\n' +
      '• 📊 **Hojas de Cálculo**: Gestionar Google Sheets.\n' +
      '• 💳 **Suscripciones**: Gestionar tu acceso premium.\n\n' +
      '**Precios (SaaS):**\n' +
      '• Mensual: €20 | Anual: €192\n' +
      'Dime "vincular mi cuenta de Google" o "quiero suscribirme" para empezar.',
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

    processVoiceMessage(ctx, userId);
  });

  // Procesamiento de voz en background
  async function processVoiceMessage(ctx: any, userId: string) {
    await ctx.replyWithChatAction('typing');
    // feedback visual discreto
    const statusMsg = await ctx.reply('🎤 Escuchando y procesando...');

    try {
      const voice = ctx.message.voice;
      const transcription = await transcribeAudio(voice.file_id, config.telegram.botToken);

      if (transcription.startsWith('⚠️') || transcription.startsWith('Error')) {
        await ctx.reply(transcription);
        return;
      }

      // feedback visual de lo escuchado
      console.log(`🎤 Escuchado con éxito (${userId})`);
      
      // En lugar de borrarlo, lo actualizamos con la transcripción para que el usuario verifique
      try { 
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `📝 Transcripción: "${transcription}"`); 
      } catch {
        // Fallback si no se puede editar (ej. mensaje muy antiguo)
        await ctx.reply(`📝 Transcripción: "${transcription}"`);
      }
      
      await ctx.replyWithChatAction('typing');

      // Procesar con el agente
      const result = await runAgent(userId, transcription);

      // Siempre enviar la respuesta en texto
      await sendLongMessage(ctx, result.response, 'Markdown');

      // Responder en audio (siempre para notas de voz)
      const audioUsers = true;
      const audioFiles = audioUsers ? await generateAudio(result.response) : [];
      if (audioFiles.length > 0) {
        await ctx.replyWithChatAction('record_voice');
        for (const audioFile of audioFiles) {
          try {
            if (fs.existsSync(audioFile) && fs.statSync(audioFile).size > 100) {
              await ctx.replyWithVoice(new InputFile(audioFile));
              console.log(`✅ Audio enviado con éxito: ${audioFile}`);
            } else {
              console.warn(`⚠️ Audio vacío o inexistente saltado: ${audioFile}`);
            }
          } catch (e) { 
            console.error(`❌ Error enviando audio (${audioFile}):`, e); 
          } finally {
            // Siempre intentar borrar para no llenar el disco (y su carpeta padre)
            if (fs.existsSync(audioFile)) {
              try { 
                const parentDir = path.dirname(audioFile);
                fs.unlinkSync(audioFile); 
                if (parentDir.includes('tts_')) {
                  fs.rmSync(parentDir, { recursive: true, force: true });
                }
              } catch {}
            }
          }
        }
      } else if (audioUsers) {
        // Fallback inmediato si no se generó audio
        await ctx.reply('🔊 Voz temporalmente no disponible, te respondo en texto.');
      }
    } catch (error) {
      console.error('Error procesando audio:', error);
      await ctx.reply('🎤 Voz temporalmente no disponible. Te respondo en texto.');
      // En caso de error crítico de voz, ya se envió el texto arriba (line 182)
    } finally {
      // Limpieza extra por si quedó algo en temp
      try {
        const files = fs.readdirSync(TEMP_DIR);
        if (files.length > 50) { // Auto-limpieza si hay saturación
          console.log("🧹 Limpiando exceso de archivos en TEMP_DIR...");
          files.forEach(file => {
            const fullPath = path.join(TEMP_DIR, file);
            if (fs.existsSync(fullPath)) {
              const stats = fs.statSync(fullPath);
              if (stats.isDirectory() && file.startsWith('tts_')) {
                fs.rmSync(fullPath, { recursive: true, force: true });
              } else if (file.endsWith('.mp3')) {
                fs.unlinkSync(fullPath);
              }
            }
          });
        }
      } catch (err) {
        console.warn('⚠️ Error en auto-limpieza:', err);
      }
    }
  }

  // Manejar mensajes de texto
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const userMessage = ctx.message.text;

    // Ignorar comandos
    if (userMessage.startsWith('/')) return;

    // Lanzar procesamiento en background para no bloquear grammy
    processTextMessage(ctx, userId, userMessage);
  });

  // Procesamiento de texto en background (no bloquea el event loop de grammy)
  async function processTextMessage(ctx: any, userId: string, userMessage: string) {
    await ctx.replyWithChatAction('typing');

    try {
      const result = await runAgent(userId, userMessage);

      // Contar interacción y verificar si toca mostrar mensaje de precios
      const userData = await firebase.getUserData(userId) || {};
      const interactionCount = (userData.interactionCount || 0) + 1;
      await firebase.updateUserData(userId, { interactionCount });

      // Mensaje de precios después de la 4ª interacción
      let pricingMessage = '';
      if (interactionCount === 4 && userId !== config.telegram.adminId) {
        const isActive = await payments.isSubscriptionActive(userId);
        if (!isActive) {
          pricingMessage = '\n\n---\n\n💡 **¿Te está siendo útil?**\n' +
            'Tu prueba gratis continúa. Cuando acabes los 7 días, puedes seguir usándome con:\n' +
            '• **Plan Mensual**: €10/mes\n' +
            '• **Plan Anual**: €100/año (2 meses gratis)\n' +
            'Di "enlace de suscripción" para ver las opciones.';
        }
      }

      // Siempre enviar la respuesta en texto
      await sendLongMessage(ctx, result.response + pricingMessage, 'Markdown');

      // Si el usuario tiene modo audio activado, responder con voz (Probamos con ElevenLabs o Fallbacks)
      if (audioModeUsers.has(userId)) {
        const audioFiles = await generateAudio(result.response);
        if (audioFiles.length > 0) {
          await ctx.replyWithChatAction('record_voice');
          for (const audioFile of audioFiles) {
            try {
              if (fs.existsSync(audioFile) && fs.statSync(audioFile).size > 100) {
                await ctx.replyWithVoice(new InputFile(audioFile));
                console.log(`✅ Audio enviado (Modo Texto): ${audioFile}`);
              }
            } catch (e) {
              console.error(`❌ Error enviando audio (Modo Texto): ${audioFile}`, e);
            } finally {
              if (fs.existsSync(audioFile)) {
                try { 
                  const parentDir = path.dirname(audioFile);
                  fs.unlinkSync(audioFile); 
                  if (parentDir.includes('tts_')) {
                    fs.rmSync(parentDir, { recursive: true, force: true });
                  }
                } catch {}
              }
            }
          }
        } else {
          // Fallback inmediato si no se generó audio en modo voz activado
          await ctx.reply('🎤 Voz temporalmente no disponible. Te respondo en texto.');
        }
      }
    } catch (error) {
      console.error('Error procesando mensaje:', error);
      await ctx.reply('❌ Ocurrió un error procesando tu mensaje. Inténtalo de nuevo.');
    }
  }

  // Manejar documentos subidos
  bot.on('message:document', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const document = ctx.message.document;
    const fileName = document.file_name || `file_${Date.now()}`;

    processDocumentMessage(ctx, userId, document, fileName);
  });

  // Procesamiento de documentos en background
  async function processDocumentMessage(ctx: any, userId: string, document: any, fileName: string) {
    await ctx.reply(`📎 Recibido: ${fileName}\n⏳ Descargando...`);

    try {
      const file = await ctx.api.getFile(document.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      const savePath = path.join(UPLOADS_DIR, fileName);

      fs.writeFileSync(savePath, Buffer.from(buffer));
      
      // ✅ SUBIDA AUTOMÁTICA A DRIVE
      const driveFileId = await uploadToDriveAuto(userId, savePath, fileName, ctx);

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
      let driveMsg = driveFileId ? `Este archivo ya ha sido subido a tu Google Drive (ID: ${driveFileId}). ` : "";
      const prompt = `El usuario ha subido un archivo llamado "${fileName}". ${driveMsg}El contenido extraído es:\n\n${textContent.slice(0, 30000)}\n\nSi el usuario te ha pedido guardarlo en una carpeta específica, usa las herramientas de Drive para mover el archivo (ID: ${driveFileId || "No disponible"}).`;

      const result = await runAgent(userId, prompt);
      await sendLongMessage(ctx, result.response, 'Markdown');

    } catch (error) {
      console.error('Error procesando archivo:', error);
      await ctx.reply(`✅ Archivo guardado en: ./uploads/${fileName}\n\n⚠️ No pude analizar el contenido automáticamente. Dime "Lee el archivo ./uploads/${fileName}" y lo leeré.`);
    }
  }

  // Manejar fotos
  bot.on('message:photo', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;

    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1]; // La más grande

    processPhotoMessage(ctx, userId, photo);
  });

  // Procesamiento de fotos en background
  async function processPhotoMessage(ctx: any, userId: string, photo: any) {
    await ctx.reply('📷 Foto recibida. Analizando...');
    await ctx.replyWithChatAction('typing');

    try {
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;

      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      const base64Image = Buffer.from(buffer).toString('base64');

      // ✅ GUARDAR Y SUBIR A DRIVE
      const fileName = `img_${Date.now()}.jpg`;
      const savePath = path.join(UPLOADS_DIR, fileName);
      fs.writeFileSync(savePath, Buffer.from(buffer));
      const driveFileId = await uploadToDriveAuto(userId, savePath, fileName, ctx);

      let driveMsg = driveFileId ? `Esta imagen ya ha sido subida a tu Google Drive (ID: ${driveFileId}). ` : "";
      const userCaption = ctx.message?.caption || '¿Qué ves en esta imagen?';
      const prompt = [
        { type: 'text', text: `${driveMsg}${userCaption}\n\nSi el usuario te ha pedido guardarla en una carpeta específica, usa las herramientas de Drive para moverla (ID: ${driveFileId || "No disponible"}).` },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`
          }
        }
      ];

      const result = await runAgent(userId, prompt);
      await sendLongMessage(ctx, result.response, 'Markdown');

    } catch (error) {
      console.error('Error procesando foto:', error);
      await ctx.reply('📷 Foto recibida. ¿Qué quieres saber sobre ella?');
    }
  }

  return bot;
}

async function sendLongMessage(ctx: any, message: string, parse_mode?: any): Promise<void> {
  const maxLength = 4000;
  if (!message) return;
  const options = parse_mode ? { parse_mode } : {};

  if (message.length <= maxLength) {
    await ctx.reply(message, options).catch((e: Error) => {
      console.error('Error reply:', e);
      // Fallback: tratar de enviar sin parse_mode si el markdown está roto
      if (parse_mode) ctx.reply(message).catch(() => {});
    });
  } else {
    const parts = [];
    for (let i = 0; i < message.length; i += maxLength) {
      parts.push(message.slice(i, i + maxLength));
    }
    for (const part of parts) {
      await ctx.reply(part, options).catch((e: Error) => {
        console.error('Error reply part:', e);
        if (parse_mode) ctx.reply(part).catch(() => {});
      });
    }
  }
}

// Cache para evitar reintentar ElevenLabs si la API key es inválida
let elevenlabsDisabled = false;
let elevenlabsDisabledUntil = 0;

/**
 * Genera archivos de audio a partir de texto usando varios proveedores con fallback.
 */
async function generateAudio(text: string): Promise<string[]> {
  // Asegurar que el directorio de audio existe (Requerido por el usuario)
  const tempDir = '/app/temp';
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const speechChunks = cleanTextForSpeech(text);
  if (speechChunks.length === 0 || (speechChunks.length === 1 && !speechChunks[0])) return [];

  const audioFiles: string[] = [];

  for (let i = 0; i < speechChunks.length; i++) {
    const part = speechChunks[i]?.trim();
    if (!part) continue;

    const timestamp = Date.now();
    const outputPath = path.join(TEMP_DIR, `voice_${timestamp}_${i}.mp3`);
    let generated = false;

    // 1️⃣ ElevenLabs (Premium)
    if (config.elevenlabs.apiKey && !elevenlabsDisabled) {
      const voiceIds = config.voice.elevenlabsVoiceIds;
      for (const voiceId of voiceIds) {
        try {
          console.log(`🎙️ ElevenLabs: Generando parte ${i + 1}...`);
          const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'xi-api-key': config.elevenlabs.apiKey,
            },
            body: JSON.stringify({
              text: part,
              model_id: 'eleven_multilingual_v2',
              voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
          });
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            fs.writeFileSync(outputPath, Buffer.from(buffer));
            if (fs.existsSync(outputPath)) {
              console.log(`✅ ElevenLabs: OK para parte ${i + 1}.`);
              audioFiles.push(outputPath);
              generated = true;
              break;
            }
          } else if (response.status === 401) {
            elevenlabsDisabled = true;
            setTimeout(() => { elevenlabsDisabled = false; }, 3600000);
            break;
          }
        } catch (err) {
          console.warn('⚠️ ElevenLabs Error:', err);
        }
      }
      if (generated) continue;
    }

    // 2️⃣ Edge-TTS (Natural y Gratis) - El favorito de v1.4
    try {
      if (!generated) {
        console.log(`🎙️ Edge-TTS: Generando voz natural para parte ${i + 1}...`);
        
        // 📁 Crear subcarpeta ÚNICA por llamada (Fix PROD ENOENT colisiones)
        const callTempDir = path.join(TEMP_DIR, `tts_${Date.now()}_${i}`);
        if (!fs.existsSync(callTempDir)) fs.mkdirSync(callTempDir, { recursive: true });
        
        const edgePath = path.resolve(callTempDir, `edge_output.mp3`);
        const tts = new MsEdgeTTS();
        
        await tts.setMetadata('es-ES-AlvaroNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

        const edgeResult = await tts.toFile(edgePath, part);
        const filePath = typeof edgeResult === 'string' ? edgeResult : edgeResult?.audioFilePath;
        
        if (filePath && fs.existsSync(filePath)) {
          audioFiles.push(filePath);
          generated = true;
          console.log(`✅ Edge-TTS: OK parte ${i+1}.`);
        }
      }
    } catch (err) {
      console.error('❌ Edge-TTS Falló:', err);
    }
    if (generated) continue;

    // 3️⃣ TTSMP3 (Amazon Polly)
    if (!generated) {
      const pollyVoices = config.voice.fallbackVoices;
      for (const speaker of pollyVoices) {
        try {
          console.log(`🎙️ TTSMP3: Probando voz "${speaker}" para parte ${i + 1}...`);
          const postRes = await fetch('https://ttsmp3.com/makemp3_new.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ msg: part, lang: speaker, source: 'ttsmp3' }).toString()
          });
          if (postRes.ok) {
            const data: any = await postRes.json();
            if (data.Error === 0 && data.URL) {
              const audioRes = await fetch(data.URL);
              if (audioRes.ok) {
                fs.writeFileSync(outputPath, Buffer.from(await audioRes.arrayBuffer()));
                if (fs.existsSync(outputPath)) {
                  console.log(`✅ TTSMP3: "${speaker}" OK.`);
                  audioFiles.push(outputPath);
                  generated = true;
                  break;
                }
              }
            }
          }
        } catch (err) {
          console.warn(`⚠️ TTSMP3 "${speaker}" Falló:`, err);
        }
      }
    }

    // 4️⃣ node-gtts (Último recurso: Google Translate TTS - Robótico pero infalible)
    if (!generated) {
      try {
        console.log(`🎙️ node-gtts: Usando fallback final para parte ${i + 1}...`);
        const gtts = require('node-gtts')('es');
        await new Promise<void>((resolve, reject) => {
          gtts.save(outputPath, part, (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
        if (fs.existsSync(outputPath)) {
          console.log(`✅ node-gtts: OK.`);
          audioFiles.push(outputPath);
          generated = true;
        }
      } catch (err) {
        console.warn('⚠️ node-gtts Falló:', err);
      }
    }
  }

  return audioFiles;
}

/**
 * Helper para subir archivos a Google Drive automáticamente.
 */
async function uploadToDriveAuto(userId: string, filePath: string, fileName: string, ctx: any): Promise<string | undefined> {
  try {
    const drive = await getDriveClient(userId);
    if (!drive) {
      console.warn(`⚠️ Drive: Usuario ${userId} no ha autorizado acceso a Drive. No se subirá automáticamente.`);
      return undefined;
    }

    console.log(`☁️ Drive: Subiendo "${fileName}" para ${userId}...`);

    // 1. Buscar carpeta OpenCodeAgent_Uploads
    let folderId: string | undefined;
    const search = await drive.files.list({
      q: "name = 'OpenCodeAgent_Uploads' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: 'files(id)',
    });
    
    if (search.data.files && search.data.files.length > 0) {
      folderId = search.data.files[0].id!;
    } else {
      const folder = await drive.files.create({
        requestBody: { name: 'OpenCodeAgent_Uploads', mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id',
      });
      folderId = folder.data.id!;
    }

    // 2. Subir archivo
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf', 
      '.jpg': 'image/jpeg', 
      '.jpeg': 'image/jpeg', 
      '.png': 'image/png'
    };

    const res = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: mimeMap[ext] || 'application/octet-stream', body: fs.createReadStream(filePath) },
      fields: 'id, webViewLink',
    });

    console.log(`✅ Drive: Archivo subido con éxito (ID: ${res.data.id}).`);
    await ctx.reply(`☁️ **Cargado en Drive (Carpeta: OpenCodeAgent_Uploads)**\n🆔 **ID:** \`${res.data.id}\`\n🔗 [Ver archivo](${res.data.webViewLink})`, { parse_mode: 'Markdown' });
    
    return res.data.id || undefined;
  } catch (err) {
    console.error('❌ Error en uploadToDriveAuto:', err);
    return undefined;
  }
}


