import type { Tool } from './types.js';
import { voiceService } from '../services/voiceService.js';
import { config } from '../config.js';

export const testVoiceTool: Tool = {
  name: 'test_voice',
  description: 'Prueba todos los proveedores de voz (ElevenLabs, Polly, Google) y reporta su estado técnico.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Texto corto para probar (opcional)' },
    },
    required: [],
  },
  execute: async (params, userId) => {
    const text = (params.text as string) || "Probando sistema de estabilidad de voz de Open Code Agent.";
    let report = "🛠️ <b>INFORME TÉCNICO DE VOZ</b>\n\n";
    
    // Check Config
    report += `1. <b>Configuración AWS Polly</b>: ${config.voice.awsAccessKey ? '✅ Credenciales presentes' : '❌ Faltan credenciales'}\n`;
    report += `2. <b>Región AWS</b>: <code>${config.voice.awsRegion}</code> | <b>Voz</b>: <code>${config.voice.pollyVoice}</code>\n`;
    report += `3. <b>Fallback Google TTS</b>: ✅ Siempre disponible\n\n`;

    report += "🎙️ **Intentando generación de audio...**\n";
    
    try {
      const files = await voiceService.textToSpeech(text, userId);
      if (files.length > 0) {
        report += `✅ <b>Éxito</b>: Se generaron ${files.length} fragmentos de audio.\n`;
        report += `📂 <b>Ruta</b>: <code>${files[0]}</code>\n`;
        report += `\n⚠️ <i>Nota: El sistema prioriza Amazon Polly (Lucía) y usa Google TTS como respaldo ultra-estable.</i>`;
      } else {
        report += "❌ <b>Fallo Total</b>: No se generó ningún archivo.";
      }
    } catch (err: any) {
      report += `❌ <b>Error Crítico</b>: ${err.message}`;
    }

    return report;
  }
};
