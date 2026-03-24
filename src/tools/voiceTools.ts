import fs from 'fs';
import path from 'path';
import type { Tool } from './types.js';
import { config } from '../config.js';

export const textToSpeechTool: Tool = {
  name: 'text_to_speech',
  description: 'Convierte texto a audio usando Google TTS',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Texto a convertir a voz',
      },
    },
    required: ['text'],
  },
  execute: async (params) => {
    const text = params.text as string;
    const truncatedText = text.length > 2000 ? text.slice(0, 2000) + '...' : text;
    const outputPath = path.resolve(`./temp_voice_${Date.now()}.mp3`);
    
    try {
      const gtts = (await import('node-gtts')).default;
      return new Promise<string>((resolve, reject) => {
        const stream = gtts(truncatedText, 'es');
        const writeStream = fs.createWriteStream(outputPath);
        stream.pipe(writeStream);
        writeStream.on('finish', () => resolve(`AUDIO_READY:${outputPath}`));
        writeStream.on('error', reject);
      });
    } catch (error) {
      return `Error generando audio: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export async function transcribeAudio(fileId: string, botToken: string): Promise<string> {
  const tempPath = path.resolve(`./temp_audio_${Date.now()}.ogg`);
  const wavPath = path.resolve(`./temp_audio_${Date.now()}.wav`);
  
  try {
    // 1. Obtener info del archivo de Telegram
    const fileResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    );
    const fileData = await fileResponse.json();
    
    if (!fileData.ok) {
      return 'Error obteniendo archivo de audio de Telegram';
    }
    
    // 2. Descargar archivo
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const audioResponse = await fetch(downloadUrl);
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    
    // 3. Guardar temporalmente
    fs.writeFileSync(tempPath, audioBuffer);
    
    // 4. Transcribir con Groq Whisper (gratis)
    if (!config.groq.apiKey) {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      return '⚠️ Groq API no configurada para transcripción.';
    }
    
    const Groq = (await import('groq-sdk')).default;
    const groq = new Groq({ apiKey: config.groq.apiKey });
    
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-large-v3',
      language: 'es',
      response_format: 'json',
    });
    
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return transcription.text || 'No se pudo transcribir el audio';
    
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    return `Error transcribiendo: ${error instanceof Error ? error.message : String(error)}`;
  }
}
