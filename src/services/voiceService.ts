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

    // Priorizamos variables de entorno directas para AWS (estándar de SDK)
    const awsAccessKey = process.env.AWS_ACCESS_KEY_ID || config.voice.awsAccessKey;
    const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY || config.voice.awsSecretKey;
    const awsRegion = process.env.AWS_REGION || config.voice.awsRegion || "us-east-1";

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk || chunk.trim().length === 0) continue;
      
      const fileName = `reply_${userId}_${Date.now()}_part${i}.mp3`;
      const filePath = path.join(TEMP_DIR, fileName);
      let success = false;

      // --- INTENTO 1: ELEVENLABS (Premium Ultra) ---
      if (config.elevenlabs.apiKey) {
        try {
          console.log(`🎙️ [VOICE] Intentando ElevenLabs (Parte ${i+1}/${chunks.length})...`);
          const voiceId = config.voice.elevenlabsVoiceIds[0] || "21m00Tcm4TlvDq8ikWAM";
          const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
          
          const response = await axios({
            method: 'POST',
            url: url,
            data: {
              text: chunk,
              model_id: "eleven_multilingual_v2",
              voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true }
            },
            headers: {
              'xi-api-key': config.elevenlabs.apiKey,
              'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer'
          });

          fs.writeFileSync(filePath, Buffer.from(response.data));
          console.log(`✅ [VOICE] ElevenLabs exitoso.`);
          generatedFiles.push(filePath);
          success = true;
        } catch (error: any) {
          const status = error.response?.status;
          const detail = error.response?.data ? Buffer.from(error.response.data).toString() : error.message;
          console.warn(`⚠️ [VOICE] ElevenLabs falló (Status: ${status}). Motivo: ${detail}`);
        }
      }

      // --- INTENTO 2: AMAZON POLLY (Premium Neural) ---
      if (!success && awsAccessKey && awsSecretKey) {
        try {
          console.log(`🎙️ [VOICE] Intentando Amazon Polly Neural (Parte ${i+1}/${chunks.length})...`);
          const polly = new PollyClient({
            region: awsRegion,
            credentials: {
              accessKeyId: awsAccessKey.trim(),
              secretAccessKey: awsSecretKey.trim()
            }
          });

          const command = new SynthesizeSpeechCommand({
             OutputFormat: "mp3",
             Text: chunk,
             VoiceId: (config.voice.pollyVoice || "Lucia") as any,
             Engine: "neural"
          });
          
          const response = await polly.send(command);
          if (response.AudioStream) {
            const buffer = Buffer.from(await response.AudioStream.transformToByteArray());
            fs.writeFileSync(filePath, buffer);
            console.log(`✅ [VOICE] Amazon Polly Neural exitoso.`);
            generatedFiles.push(filePath);
            success = true;
          }
        } catch (error: any) {
          console.warn(`⚠️ [VOICE] Amazon Polly falló. Error: ${error.name} - ${error.message}`);
          if (error.name === 'InvalidSignatureException') {
            console.error("❌ [VOICE] Error Crítico: Las claves de AWS no son válidas o tienen espacios extra.");
          }
        }
      }

      // --- INTENTO 3: GOOGLE TTS (Respaldo Estándar - "Robótico") ---
      if (!success) {
        try {
          console.log(`🎙️ [VOICE] Intentando Google TTS (Respaldo Final)...`);
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
          console.log(`✅ [VOICE] Google TTS exitoso (Nota: Calidad reducida).`);
          generatedFiles.push(filePath);
          success = true;
        } catch (error: any) {
          console.error(`❌ [VOICE] Todos los servicios de voz fallaron. Error:`, error.message);
          // Alerta especial si parece un problema de conexión o cuotas generales
          if (error.message.includes('quota') || error.message.includes('429')) {
             console.error("📊 [VOICE] Sugerencia: Revisa tus cuotas de API de Google/ElevenLabs.");
          }
        }
      }
    }

    if (generatedFiles.length === 0) {
      console.warn("⚠️ [VOICE] No se generó ningún archivo de audio.");
    }

    return generatedFiles;
  }
};
