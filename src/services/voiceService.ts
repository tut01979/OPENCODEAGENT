import axios from "axios";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import * as googleTTS from 'google-tts-api';
import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { cleanTextForSpeech } from "../utils/sanitize.js";

const TEMP_DIR = '/app/temp';

export const voiceService = {
  async textToSpeech(text: string, userId: string | number): Promise<string[]> {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    
    // REGLA: Usar el filtrado centralizado que limpia URLs, emojis y caracteres raros
    const chunks = cleanTextForSpeech(text); 
    const generatedFiles: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk || chunk.trim().length === 0) continue;
      
      const fileName = `reply_${userId}_${Date.now()}_part${i}.mp3`;
      const filePath = path.join(TEMP_DIR, fileName);
      let success = false;

      // --- 1. INTENTO CON AMAZON POLLY (Prioridad Superior - Calidad Neural) ---
      if (config.voice.awsAccessKey && config.voice.awsSecretKey) {
        try {
          console.log(`🎙️ [VOICE] Intentando Amazon Polly (Neural) - Parte ${i+1}/${chunks.length}...`);
          
          // Limpiamos credenciales de posibles espacios o recortes mal hechos
          const accessKey = config.voice.awsAccessKey.replace(/[^A-Z0-9]/g, '').trim();
          const secretKey = config.voice.awsSecretKey.trim();
          const region = config.voice.awsRegion || 'us-east-1';

          const polly = new PollyClient({
            region,
            credentials: {
              accessKeyId: accessKey,
              secretAccessKey: secretKey,
            },
          });

          const command = new SynthesizeSpeechCommand({
            Text: chunk,
            OutputFormat: 'mp3',
            VoiceId: (config.voice.pollyVoice || 'Lucia') as any,
            Engine: 'neural',
          });

          const response = await polly.send(command).catch(async (err) => {
            if (err.name === 'ValidationException' || err.message.includes('Engine')) {
              console.log('⚠️ [VOICE] Reintentando Polly en modo Standard (Neural no disponible)');
              return await polly.send(new SynthesizeSpeechCommand({
                Text: chunk,
                OutputFormat: 'mp3',
                VoiceId: (config.voice.pollyVoice || 'Lucia') as any,
                Engine: 'standard',
              }));
            }
            throw err;
          });

          if (response.AudioStream) {
            const buffer = Buffer.from(await response.AudioStream.transformToByteArray());
            fs.writeFileSync(filePath, buffer);
            console.log('✅ [VOICE] Amazon Polly completado.');
            generatedFiles.push(filePath);
            success = true;
          }
        } catch (error) {
          console.warn('⚠️ [VOICE] Amazon Polly falló. Pasando a fallback...', error instanceof Error ? error.message : String(error));
        }
      }

      // --- 2. INTENTO CON GOOGLE TTS (Fallback Estable - Muy robusto) ---
      if (!success) {
        try {
          console.log(`🎙️ [VOICE] Intentando Google TTS (Fallback) - Parte ${i+1}/${chunks.length}...`);
          const audioData = await googleTTS.getAllAudioBase64(chunk, {
            lang: 'es',
            slow: false,
            host: 'https://translate.google.com',
            timeout: 10000,
          });
          
          let completeAudio = Buffer.alloc(0);
          for (const piece of audioData) {
            completeAudio = Buffer.concat([completeAudio, Buffer.from(piece.base64, 'base64')]);
          }
          
          fs.writeFileSync(filePath, completeAudio);
          console.log(`✅ [VOICE] Google TTS completado.`);
          generatedFiles.push(filePath);
          success = true;
        } catch (error: any) {
          console.warn(`⚠️ [VOICE] Google TTS falló: ${error.message}`);
        }
      }

      // --- 3. ÚLTIMO RECURSO ---
      if (!success) {
        console.error(`❌ [VOICE] No se pudo generar audio para la parte ${i+1} con ningún servicio disponible.`);
      }
    }

    if (generatedFiles.length === 0) {
      console.error("❌ CRÍTICO: No se pudo generar audio con ningún servicio.");
    }

    return generatedFiles;
  }
};
