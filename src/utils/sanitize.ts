/**
 * Utilidad centralizada de sanitización y formateo premium.
 * Mantiene negritas, separadores, emojis útiles y saltos de línea limpios.
 */

export const SEP = '------------------------------';

/**
 * Limpia texto de caracteres de control, BOM, scripts y lo limita a maxLength.
 * PRESERVA: negritas (**), emojis, separadores (━), saltos de línea.
 * ELIMINA: BOM, chars de control, scripts maliciosos.
 */
export function sanitizeOutput(text: string, maxLength = 4000): string {
  if (!text) return '';
  let cleaned = text
    .replace(/\uFEFF/g, '') // Quitar BOM UTF-8
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Quitar chars de control (no rompe emojis)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Quitar scripts
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '') // Quitar bloques de pensamiento de modelos como DeepSeek/Gemini
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

  // 🛡️ Limpieza avanzada de caracteres extraños y repeticiones
  cleaned = cleaned.replace(/#{3,}/g, '###'); // Normalizar títulos excesivos
  cleaned = cleaned.replace(/(\*\*\s*){2,}/g, '**'); // Quitar negritas repetitivas vacías
  cleaned = cleaned.replace(/(\n\s*){3,}/g, '\n\n'); // Max 2 saltos de línea
  cleaned = cleaned.replace(/[\u2500-\u257F\u2580-\u259F]/g, ''); // Dibujo de cajas residual
  cleaned = cleaned.replace(/â€/g, "'"); // Corregir errores comunes de encoding
  cleaned = cleaned.replace(/ï¿½/g, ''); // Quitar reemplazos de caracteres desconocidos
  
  return cleaned.slice(0, maxLength).trim(); 
}

/**
 * Limpia texto para síntesis de voz (TTS).
 * Elimina bloques de código, tablas, markdown, enlaces y emojis.
 * Mantiene pausas naturales (puntos, comas, puntos y coma).
 * Corta frases largas en segmentos de máximo 3000 caracteres.
 * Devuelve un array de fragmentos listos para voz.
 */
export function cleanTextForSpeech(text: string): string[] {
  if (!text) return [''];

  let cleaned = text;

  // 1. Omitir bloques de código y tablas
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ' bloque de código omitido. ');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  cleaned = cleaned.replace(/\|[\s\S]*?\|/g, ' ');

  // 2. REGLA: Sustituir enlaces/URLs por "enlace en pantalla"
  // Markdown links: [texto](url) -> "texto, enlace en pantalla"
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1. Enlace en pantalla. ');
  // URLs directas (más agresivo)
  cleaned = cleaned.replace(/(https?:\/\/[^\s<>)"']+)/g, ' enlace en pantalla ');
  
  // 3. REGLA: Eliminar emojis y caracteres raros completamente
  // Eliminar símbolos de Markdown (preservamos guiones entre palabras pero quitamos delimitadores)
  cleaned = cleaned.replace(/[*#~>]/g, '');
  cleaned = cleaned.replace(/(\s)_|(_\s)|^_|(_$)/g, '$1 '); // Quitar underscores de formato pero no los internos de palabras técnicas si quedan
  
  // Eliminar caracteres de dibujo de cajas y separadores
  cleaned = cleaned.replace(/[\u2500-\u257F\u2580-\u259F]/g, '');
  // Eliminar emojis garantizando cobertura total (Unicode planes)
  cleaned = cleaned.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F200}-\u{1F2FF}\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}]/gu, '');
  // Eliminar otros símbolos técnicos que la voz lee mal
  cleaned = cleaned.replace(/[\\^°@$€&%+={}[\]]/g, ' ');

  // 4. Limpieza de espacios y puntuación para fluidez natural
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/\s+([.,!?;:])/g, '$1');
  cleaned = cleaned.replace(/([.!?])([A-ZÁÉÍÓÚÑ])/g, '$1 $2');
  
  // Reemplazos fonéticos premium (Español)
  cleaned = cleaned.replace(/v1\.4\.1/gi, 'versión uno punto cuatro punto uno');
  cleaned = cleaned.replace(/v1\.4/gi, 'versión uno punto cuatro');
  cleaned = cleaned.replace(/\bSaaS\b/gi, 'Sás');
  cleaned = cleaned.replace(/\bAI\b/gi, 'I.A.');
  cleaned = cleaned.replace(/\bGPT\b/gi, 'ye pe té');
  cleaned = cleaned.replace(/\bLLM\b/gi, 'L.L.M.');
  cleaned = cleaned.replace(/\bPDF\b/gi, 'P.D.F.');
  cleaned = cleaned.replace(/\bURL\b/gi, 'U.R.L.');
  cleaned = cleaned.replace(/\bDrive\b/gi, 'Draiv');
  cleaned = cleaned.replace(/\bGmail\b/gi, 'Yimeil');
  cleaned = cleaned.replace(/\bGoogle\b/gi, 'Gúgel');
  cleaned = cleaned.replace(/\bStripe\b/gi, 'Estraip');
  cleaned = cleaned.replace(/\bTelegram\b/gi, 'Télegram');
  cleaned = cleaned.replace(/\bbot\b/gi, 'bót');
  cleaned = cleaned.replace(/\bWhatsApp\b/gi, 'guasáp');
  cleaned = cleaned.replace(/\bOAuth2\b/gi, 'O-Aut dos');
  cleaned = cleaned.replace(/\bCalendar\b/gi, 'Cálendar');
  cleaned = cleaned.replace(/\bSheets\b/gi, 'Shíts');
  cleaned = cleaned.replace(/\bYouTube\b/gi, 'Yutub');



  const MAX_CHUNK = 3000;
  if (cleaned.length <= MAX_CHUNK) {
    const words = cleaned.split(' ').filter(w => w.length > 0);
    if (words.length <= 200) return [cleaned || 'Transacción completada'];
    return splitBySentences(cleaned, 200);
  }

  const chunks: string[] = [];
  let remaining = cleaned;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK) {
      chunks.push(remaining.trim());
      break;
    }

    let cutPoint = MAX_CHUNK;
    const searchArea = remaining.slice(Math.max(0, cutPoint - 500), cutPoint);

    const sentenceMatch = searchArea.match(/[.!?]+\s+(?=[A-ZÁÉÍÓÚÑ])/g);
    if (sentenceMatch && sentenceMatch.length > 0) {
      const lastSentence = searchArea.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]);
      cutPoint = Math.max(0, cutPoint - 500) + lastSentence + sentenceMatch[sentenceMatch.length - 1].trim().length;
    } else {
      const semicolonMatch = searchArea.match(/[;:]\s+/g);
      if (semicolonMatch && semicolonMatch.length > 0) {
        const lastSemicolon = searchArea.lastIndexOf(semicolonMatch[semicolonMatch.length - 1]);
        cutPoint = Math.max(0, cutPoint - 500) + lastSemicolon + semicolonMatch[semicolonMatch.length - 1].length;
      } else {
        const commaMatch = searchArea.match(/,\s+/g);
        if (commaMatch && commaMatch.length > 0) {
          const lastComma = searchArea.lastIndexOf(commaMatch[commaMatch.length - 1]);
          cutPoint = Math.max(0, cutPoint - 500) + lastComma + commaMatch[commaMatch.length - 1].length;
        } else {
          const spaceIdx = remaining.lastIndexOf(' ', cutPoint);
          if (spaceIdx > MAX_CHUNK - 500) {
            cutPoint = spaceIdx;
          }
        }
      }
    }

    const chunk = remaining.slice(0, cutPoint).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.slice(cutPoint).trim();
  }

  return chunks.length > 0 ? chunks : [cleaned];
}

function splitBySentences(text: string, maxWords: number): string[] {
  const words = text.split(' ').filter(w => w.length > 0);
  if (words.length <= maxWords) return [text];

  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    const targetEnd = Math.min(i + maxWords, words.length);
    let end = targetEnd;

    if (targetEnd < words.length) {
      const searchWindow = words.slice(Math.max(0, i + Math.floor(maxWords * 0.75)), targetEnd + 10).join(' ');
      const sentenceBreak = searchWindow.search(/[.!?]+ /);
      if (sentenceBreak !== -1) {
        const wordsBefore = searchWindow.slice(0, sentenceBreak).split(' ').length;
        end = Math.max(0, i + Math.floor(maxWords * 0.75)) + wordsBefore;
      } else {
        const commaBreak = searchWindow.search(/[,;:]+ /);
        if (commaBreak !== -1) {
          const wordsBefore = searchWindow.slice(0, commaBreak).split(' ').length;
          end = Math.max(0, i + Math.floor(maxWords * 0.75)) + wordsBefore;
        }
      }
    }

    chunks.push(words.slice(i, end).join(' '));
    i = end;
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Formatea un bloque de información con título, campos y enlace.
 * Uso: formatBlock('📄', 'Archivo', [{label: 'Nombre', value: 'doc.pdf'}, ...], link)
 */
export function formatBlock(
  icon: string,
  title: string,
  fields: { label: string; value: string }[],
  link?: string,
): string {
  let out = `${SEP}\n`;
  out += `${icon} **${title}**\n`;
  for (const f of fields) {
    out += `**${f.label}:** ${f.value}\n`;
  }
  if (link) {
    out += `🔗 **Enlace directo:** ${link}\n`;
  }
  return out;
}

/**
 * Cabecera de sección con separador superior.
 * Uso: sectionHeader('📬', '5 correos en BANDEJA DE ENTRADA')
 */
export function sectionHeader(icon: string, title: string): string {
  return `${icon} **${title}**\n\n`;
}
