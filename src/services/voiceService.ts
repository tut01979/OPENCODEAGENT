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

      // INTENTO 1: ELEVENLABS (Premium)
      if (config.elevenlabs.apiKey && !success) {
        try {
          console.log(`🎙️ Intentando ElevenLabs para la parte ${i+1}...`);
          const voiceId = config.voice.elevenlabsVoiceIds[0] || "21m00Tcm4TlvDq8ikWAM";
          const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
          
          const response = await axios({
            method: 'POST',
            url: url,
            data: {
              text: chunk,
              model_id: "eleven_multilingual_v2",
              voice_settings: { stability: 0.5, similarity_boost: 0.5 }
            },
            headers: {
              'xi-api-key': config.elevenlabs.apiKey,
              'Content-Type': 'application/json'
            },
            responseType: 'arraybuffer'
          });

          fs.writeFileSync(filePath, Buffer.from(response.data));
          console.log(`✅ ElevenLabs exitoso para la parte ${i+1}.`);
          generatedFiles.push(filePath);
          success = true;
        } catch (error: any) {
          console.warn(`⚠️ ElevenLabs falló para la parte ${i+1}, intentando respaldo 1...`);
        }
      }

      // INTENTO 2: AMAZON POLLY (Respaldo 1)
      const awsAccessKey = process.env.AWS_ACCESS_KEY_ID || config.voice.awsAccessKey;
      const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY || config.voice.awsSecretKey;

      if (awsAccessKey && awsSecretKey && !success) {
        try {
          console.log(`🎙️ Intentando Amazon Polly para la parte ${i+1} (Respaldo 1)...`);
          const polly = new PollyClient({
            region: config.voice.awsRegion,
            credentials: {
              accessKeyId: awsAccessKey,
              secretAccessKey: awsSecretKey
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
            console.log(`✅ Amazon Polly exitoso para la parte ${i+1}.`);
            generatedFiles.push(filePath);
            success = true;
          }
        } catch (error: any) {
          console.warn(`⚠️ Amazon Polly falló para la parte ${i+1}. Error de AWS:`, error.message);
        }
      }

      // INTENTO 3: GOOGLE TTS (Respaldo final y sin fallos)
      if (!success) {
        try {
          console.log(`🎙️ Intentando Google TTS para la parte ${i+1} (Respaldo Final)...`);
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
          console.log(`✅ Google TTS exitoso para la parte ${i+1}.`);
          generatedFiles.push(filePath);
          success = true;
        } catch (error: any) {
          console.error(`❌ Todos los servicios de voz fallaron para la parte ${i+1}:`, error.message);
        }
      }
    }

    return generatedFiles;
  }
};
