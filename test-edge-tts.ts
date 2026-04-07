import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import fs from 'fs';
import path from 'path';
import { cleanTextForSpeech } from './dist/utils/sanitize.js';

async function testEdgeTTS() {
  console.log('=== PRUEBA EDGE-TTS CON MENSAJE LARGO ===\n');

  const longMessage = `Hola, soy OpenCodeAgent v1.4, tu asistente ejecutivo de inteligencia artificial. Estoy aquí para ayudarte con todas tus tareas diarias de forma profesional y eficiente.

Puedo gestionar tu correo electrónico de Gmail, leer y enviar emails, organizar tu bandeja de entrada y crear respuestas profesionales. También manejo Google Calendar para crear, modificar y consultar reuniones y eventos en tu agenda.

En cuanto a Google Drive, puedo subir archivos, organizar carpetas, compartir documentos y buscar archivos específicos. Para Google Sheets, puedo leer hojas de cálculo, crear nuevas filas, actualizar datos y generar reportes automáticos.

Además, tengo capacidad de búsqueda en tiempo real en la web para encontrar información actualizada, puedo transcribir notas de voz y responder con audio natural usando Edge-TTS con la voz AlvaroNeural en español.

Este es un mensaje de prueba largo para verificar que el sistema de texto a voz funciona correctamente con Edge-TTS. La voz debe sonar natural, profesional y cálida, sin sonar robótica ni artificial.

Si todo funciona bien, deberías escuchar varios audios separados, cada uno con una parte del mensaje, manteniendo las pausas naturales en los puntos y comas para una mejor comprensión auditiva.

Gracias por probar OpenCodeAgent. Estamos comprometidos con ofrecerte la mejor experiencia posible como asistente ejecutivo inteligente.`;

  console.log(`Mensaje original: ${longMessage.length} caracteres`);

  const chunks = cleanTextForSpeech(longMessage);
  console.log(`Fragmentos generados: ${chunks.length}`);
  chunks.forEach((chunk, idx) => {
    console.log(`  Fragmento ${idx + 1}: ${chunk.length} caracteres`);
  });

  const tts = new MsEdgeTTS();
  const tmpDir = path.resolve('./tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  await tts.setMetadata('es-ES-AlvaroNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  console.log('\nVoz configurada: es-ES-AlvaroNeural');

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk || !chunk.trim()) continue;

    console.log(`\nGenerando audio ${i + 1}/${chunks.length}...`);

    try {
      const { audioFilePath } = await tts.toFile(tmpDir, chunk);
      const finalPath = path.resolve(`./test_voice_${i}.mp3`);
      fs.copyFileSync(audioFilePath, finalPath);
      try { fs.unlinkSync(audioFilePath); } catch {}
      const stats = fs.statSync(finalPath);
      console.log(`✅ Audio ${i + 1} generado: ${finalPath} (${(stats.size / 1024).toFixed(1)} KB)`);
    } catch (error) {
      console.error(`❌ Error generando audio ${i + 1}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log('\n=== PRUEBA COMPLETADA ===');
}

testEdgeTTS().catch(console.error);
