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
    let report = "🛠️ **INFORME TÉCNICO DE VOZ**\n\n";
    
    // Check Config
    report += `1. **Configuración ElevenLabs**: ${config.elevenlabs.apiKey ? '✅ API Key presente' : '❌ Falta API Key'}\n`;
    report += `2. **Configuración AWS Polly**: ${config.voice.awsAccessKey ? '✅ Credenciales presentes' : '❌ Faltan credenciales'}\n`;
    report += `3. **Región AWS**: \`${config.voice.awsRegion}\` | **Voz**: \`${config.voice.pollyVoice}\`\n\n`;

    report += "🎙️ **Intentando generación de audio...**\n";
    
    try {
      const files = await voiceService.textToSpeech(text, userId);
      if (files.length > 0) {
        report += `✅ **Éxito**: Se generaron ${files.length} fragmentos de audio.\n`;
        report += `📂 **Ruta**: \`${files[0]}\`\n`;
        report += `⚠️ *Nota: Si la voz es robótica, es que ElevenLabs y Polly fallaron y se usó el respaldo de Google.*`;
      } else {
        report += "❌ **Fallo Total**: No se generó ningún archivo.";
      }
    } catch (err: any) {
      report += `❌ **Error Crítico**: ${err.message}`;
    }

    return report;
  }
};
