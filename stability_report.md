# 🛡️ Reporte de Estabilidad: OpenCodeAgent v1.4.1 (Anti-Gravity Fix)

Se han aplicado una serie de correcciones críticas para estabilizar el comportamiento del agente en producción (Railway), eliminando errores recurrentes de archivos no encontrados, caracteres extraños y alucinaciones de enlaces.

## 1. 🎙️ Estabilización de Voz (Edge-TTS)
**Problema:** Error `ENOENT` al intentar generar audios en Railway debido a directorios temporales inexistentes o corruptos.
- **Corrección:** Se ha robustecido la inicialización del directorio `temp` usando rutas absolutas vinculadas al `cwd`.
- **🛡️ Escudo Anti-Error:** Ahora el bot verifica y recrea el directorio `/temp` inmediatamente antes de cada llamada a `edge-tts`.
- **🔄 Fallback Inteligente:** Si la voz falla por cualquier motivo técnico, el bot enviará un aviso: *"Error en audio, te respondo en texto por seguridad"*, garantizando que la respuesta nunca se pierda.
- **🧹 Auto-Limpieza:** Se añadió un recolector de basura que elimina archivos `.mp3` antiguos si el directorio supera los 50 elementos para evitar saturación del volumen.

## 2. 🔤 Sanitización de Texto (Adiós Caracteres Raros)
**Problema:** El LLM a veces incluía bloques de "pensamiento" (`<thought>`), separadores visuales rotos o repeticiones de caracteres (`###`, `**`).
- **Corrección en `sanitizeOutput`:** Se añadieron patrones para detectar y eliminar basura de codificación común como `â€` o `ï¿½`.
- **Limpieza de Repetición:** Se normalizaron los saltos de línea (máximo 2 seguidos) y se eliminaron repeticiones de negritas vacías.
- **Mejora fonética:** Se instruyó al sistema de limpieza para Traducir siglas comunes (SaaS -> Sás, AI -> I.A.) para que la voz suene más natural.

## 3. 🧠 Inteligencia y Anti-Alucinación
**Problema:** Alucinación de enlaces de YouTube o respuestas inventadas cuando las herramientas fallan.
- **Temperatura:** Ajustada de **0.3 a 0.25** en todos los modelos (Ollama, Groq, OpenRouter) para priorizar precisión sobre creatividad.
- **Reglas Estrictas:** Se inyectó en el `mainSystemPrompt.ts` una directriz de **Honestidad Radical**:
  - *"Mejor un 'no sé' que mentir."*
  - *"Prohibido inventar enlaces de YouTube."*
  - *"Solo ofrecer enlaces verificados por la herramienta `search_youtube`."*

## 🚀 Próximos Pasos sugeridos
1. **Railway:** Realiza un `railway up` para subir estos cambios.
2. **Caché:** Si los errores persisten visualmente en el dashboard, recuerda usar la opción **"Clear build cache"** al redeployar desde la web de Railway, ya que Docker suele guardar capas viejas.

---
**Status:** `Anti-Gravity limpio: voz fallback + anti-alucinación activado`.
