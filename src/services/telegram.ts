// -*- coding: utf-8 -*-
import { Bot, InputFile } from 'grammy';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { config } from '../config.js';
import { runAgent, clearUserMemory } from '../agent/agent.js';
import { transcribeAudio } from '../tools/voiceTools.js';
import { payments } from './payments.js';
import { firebase } from './firebase.js';
import { cleanTextForSpeech } from '../utils/sanitize.js';
import { voiceService } from './voiceService.js';
import { getDriveClient } from '../tools/driveTools.js';
import { memory } from './memory.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Almacenar usuarios que quieren respuestas en audio
const audioModeUsers = new Set<string>();

// 📂 Directorios de trabajo
const VERSION = 'v1.4.1 (Stable)';
const TEMP_DIR = '/app/temp';
if (!fs.existsSync(TEMP_DIR)) {
  try {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  } catch (err) {
    console.error(`❌ No se pudo crear ${TEMP_DIR}:`, err);
  }
}

const UPLOADS_DIR = path.resolve('./uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export function createBot(): Bot {
  const bot = new Bot(config.telegram.botToken);

  // Middleware de seguridad
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id.toString();
    if (!userId) {
      await ctx.reply('Error: No se pudo identificar tu usuario.');
      return;
    }
    await next();
  });

  // Comando /start
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (userId) {
      await payments.isSubscriptionActive(userId);
      await firebase.updateUserData(userId, { interactionCount: 0 });
    }
    await ctx.reply(
      '¡Hola! 👋\n\n' +
      'Soy OpenCodeAgent v1.4.1, tu Ejecutivo IA Híbrido.\n\n' +
      'Gestiono tus tareas diarias directamente desde Telegram: correo, reuniones, Drive y más.\n\n' +
      '✅ **Prueba Gratis de 7 días activada**\n\n' +
      'Dime qué necesitas hoy. ¿Qué hacemos? 🚀',
      { parse_mode: 'Markdown' }
    );
  });

  // Comando /status
  bot.command('status', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    await ctx.replyWithChatAction('typing');
    const userData = await firebase.getUserData(userId);
    let message = '📊 **TU ESTADO**\n\n';
    if (userId === config.telegram.adminId) message += '👑 **ADMIN**: Acceso ilimitado.';
    else if (userData?.subscription_status === 'active') message += '✅ **SUSCRIPCIÓN ACTIVA**.';
    else if (userData?.trial_ends_at) {
      const remainingDays = Math.ceil((userData.trial_ends_at - Date.now()) / (1000 * 60 * 60 * 24));
      message += remainingDays > 0 ? `🎁 **PRUEBA**: ${remainingDays} días restantes.` : '❌ **PRUEBA TERMINADA**.';
    }
    await ctx.reply(message, { parse_mode: 'Markdown' });
  });

  // Comando /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '📖 **Comandos disponibles:**\n' +
      '• `/conectar` - Vincula Google.\n' +
      '• `/voice` - Activa/Desactiva respuesta por voz.\n' +
      '• `/clear` - Borra el historial.\n' +
      '• `/status` - Mira tu plan.'
    );
  });

  // Comando /clear
  bot.command('clear', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (userId) {
      clearUserMemory(userId);
      await ctx.reply('🗑️ Historial borrado.');
    }
  });

  // Comando /voice
  bot.command('voice', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    if (audioModeUsers.has(userId)) {
      audioModeUsers.delete(userId);
      await ctx.reply('🔇 Modo audio desactivado.');
    } else {
      audioModeUsers.add(userId);
      await ctx.reply('🔊 Modo audio activado.');
    }
  });

  // Comando /conectar
  bot.command('conectar', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    const { generateAuthUrl } = await import('./auth.js');
    const url = generateAuthUrl(userId);
    if (!url) {
      await ctx.reply('❌ Error al generar URL.');
      return;
    }
    await ctx.reply(`🔐 [Autorizar con Google](${url})`, { parse_mode: 'Markdown' });
  });

  // 🎙️ MANEJADOR DE VOZ
  bot.on('message:voice', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    processVoiceMessage(ctx, userId);
  });

  async function processVoiceMessage(ctx: any, userId: string) {
    await ctx.replyWithChatAction('typing');
    const statusMsg = await ctx.reply('🎤 Procesando nota de voz...');
    let localPath = '';

    try {
      const fileId = ctx.message.voice.file_id;
      const file = await ctx.api.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
      
      const res = await axios({ url, responseType: 'arraybuffer' });
      localPath = path.join(process.cwd(), `temp_voice_${Date.now()}.ogg`);
      fs.writeFileSync(localPath, Buffer.from(res.data));

      const transcription = await transcribeAudio(fileId, config.telegram.botToken);
      
      if (!transcription || transcription.startsWith('⚠️')) {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, "❌ No pude entender el audio.");
        return;
      }

      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `📝 **Has dicho:** "${transcription}"`);
      
      await ctx.replyWithChatAction('typing');
      // No guardamos aquí, lo hace runAgent internamente para evitar duplicados.
      const result = await runAgent(userId, transcription);

      // ✅ RESPUESTA DUAL: SIEMPRE TEXTO + VOZ
      await sendLongMessage(ctx, result.response, 'Markdown');

      await ctx.replyWithChatAction('record_voice');
      const audioFiles = await voiceService.textToSpeech(result.response, userId);
      for (const audioFile of audioFiles) {
        if (fs.existsSync(audioFile)) {
          await ctx.replyWithVoice(new InputFile(audioFile));
          fs.unlinkSync(audioFile);
        }
      }
    } catch (error) {
      console.error('Error en voz:', error);
      await ctx.reply('⚠️ Error procesando voz.');
    } finally {
      if (localPath && fs.existsSync(localPath)) fs.unlinkSync(localPath);
    }
  }

  // 📝 MANEJADOR DE TEXTO
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId || ctx.message.text.startsWith('/')) return;
    processTextMessage(ctx, userId, ctx.message.text);
  });

  async function processTextMessage(ctx: any, userId: string, text: string) {
    const cleanMsg = text.trim().toUpperCase();
    
    // Confirmación "SÍ"
    if (cleanMsg === 'SÍ' || cleanMsg === 'SI') {
      const pending = memory.getPendingAction(userId);
      if (pending) {
        await ctx.reply('🚀 Ejecutando acción confirmada...');
        try {
          const { executeToolCall } = await import('../tools/tools.js');
          const result = await executeToolCall(pending, userId);
          memory.clearPendingAction(userId);
          await ctx.reply(`✅ Hecho:\n\n${result.content}`);
          return;
        } catch (err) {
          await ctx.reply('❌ Error ejecutando acción.');
          memory.clearPendingAction(userId);
          return;
        }
      }
    }

    await ctx.replyWithChatAction('typing');
    try {
      const result = await runAgent(userId, text);
      await sendLongMessage(ctx, result.response, 'Markdown');

      // Detectar si pide voz por palabra clave
      const voiceKeywords = ["prueba de voz", "voz", "léeme", "lee esto", "habla", "di esto", "dime con voz", "responde con voz"];
      const hasVoiceKeyword = voiceKeywords.some(kw => text.toLowerCase().includes(kw));

      if (audioModeUsers.has(userId) || hasVoiceKeyword) {
        const audioFiles = await voiceService.textToSpeech(result.response, userId);
        for (const audioFile of audioFiles) {
          if (fs.existsSync(audioFile)) {
            await ctx.replyWithVoice(new InputFile(audioFile));
            fs.unlinkSync(audioFile);
          }
        }
      }
    } catch (error) {
      console.error('Error en texto:', error);
      await ctx.reply('❌ Error procesando mensaje.');
    }
  }

  // 📎 MANEJADOR DE DOCUMENTOS
  bot.on('message:document', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    processDocumentMessage(ctx, userId, ctx.message.document);
  });

  async function processDocumentMessage(ctx: any, userId: string, doc: any) {
    await ctx.reply('📎 Recibido archivo. Analizando...');
    try {
      const fileId = doc.file_id;
      const fileName = doc.file_name || `doc_${Date.now()}`;
      const file = await ctx.api.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
      
      const res = await axios({ url, responseType: 'arraybuffer' });
      const localPath = path.join(UPLOADS_DIR, fileName);
      fs.writeFileSync(localPath, Buffer.from(res.data));

      const driveUrl = await uploadToDriveAuto(userId, localPath, fileName, ctx);
      
      let replyText = `✅ Archivo **${fileName}** recibido.`;
      if (driveUrl) {
        replyText += `\n\n📂 [Ver en Google Drive](${driveUrl})`;
      }

      await ctx.reply(replyText, { parse_mode: 'Markdown' });
      
      // Notificar al agente para que tenga el contexto
      await runAgent(userId, `He subido un archivo llamado "${fileName}" a mi Drive.`);
    } catch (error) {
      console.error('Error procesando documento:', error);
      await ctx.reply('❌ Error al procesar el archivo.');
    }
  }

  // 📷 MANEJADOR DE FOTOS
  bot.on('message:photo', async (ctx) => {
    const userId = ctx.from?.id.toString();
    if (userId) processPhotoMessage(ctx, userId, ctx.message.photo);
  });

  async function processPhotoMessage(ctx: any, userId: string, photos: any) {
    const photo = photos[photos.length - 1]; // Mayor resolución
    await ctx.reply('📷 Foto recibida. Analizando...');
    try {
      const fileId = photo.file_id;
      const file = await ctx.api.getFile(fileId);
      const url = `https://api.telegram.org/file/bot${config.telegram.botToken}/${file.file_path}`;
      
      // Enviar al agente como contexto
      await runAgent(userId, `[SISTEMA] El usuario ha enviado una imagen. Analízala si tienes herramientas de visión.`);
      await ctx.reply('He recibido la imagen. ¿Qué quieres que haga con ella?');
    } catch (error) {
      console.error('Error procesando foto:', error);
    }
  }

  return bot;
}

async function sendLongMessage(ctx: any, message: string, parse_mode?: any): Promise<void> {
  const MAX_LENGTH = 4000;
  if (!message) return;
  const parts = message.length > MAX_LENGTH ? [message.slice(0, MAX_LENGTH)] : [message]; 
  const options = parse_mode ? { parse_mode } : {};
  for (const part of parts) {
    try { await ctx.reply(part, options); } 
    catch { await ctx.reply(part); }
  }
}

async function uploadToDriveAuto(userId: string, filePath: string, fileName: string, ctx: any): Promise<string | undefined> {
  try {
    const drive = await getDriveClient(userId);
    if (!drive) return undefined;

    const fileMetadata = { name: fileName };
    const media = {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(filePath),
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    return file.data.webViewLink || undefined;
  } catch (error) {
    console.error('Error subiendo a Drive:', error);
    return undefined;
  }
}
