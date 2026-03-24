---
name: OpenCode Master Agent Creator
description: Arquitectura y despliegue para replicar agentes IA personales con Visión Híbrida, Google Workspace y despliegue en la nube (Railway/Docker).
---

# 🤖 OpenCode Master Agent: Arquitectura Híbrida v2.0

![Arquitectura Maestra de OpenCode AI](file:///C:/Users/eduar/.gemini/antigravity/brain/52f2198b-6b4c-4025-a815-83f5f65e2057/opencode_ai_architecture_system_1774127384573.png)

Esta Skill documenta la configuración definitiva de un asistente agentic que combina lo mejor de dos mundos: **Visión sin filtros** y **Razonamiento de documentos pesados**.

## 🧠 Núcleo de Inteligencia Híbrida
El agente ajusta su "cerebro" dinámicamente según la tarea:

1.  **👁️ Visión (Gemini 2.0 Flash)**: 
    *   **Uso**: Análisis de imágenes, capturas de pantalla, fotos personales y selfies.
    *   **Ventaja**: Evita los bloqueos de seguridad de OpenAI al describir rostros y es extremadamente rápido.
2.  **📄 Razonamiento (GPT-4o mini / Llama 3.3 70B)**:
    *   **Uso**: Análisis de PDFs extensos, lógica de programación y redacción de emails.
    *   **Ventaja**: Gran capacidad de seguimiento de instrucciones complejas y manejo de contexto de texto.

## 🛠️ Catálogo de 25 Herramientas Integradas
El agente está equipado con una suite completa de automatización:

| Categoría | Herramientas Principales |
| :--- | :--- |
| **Google Drive** | `read_drive_file` (v2), `search_drive`, `upload`, `manage_folders`. |
| **Gmail** | `get_email_details`, `download_attachment`, `send`, `list`. |
| **Sheets** | `read_sheet`, `write_sheet`, `append_sheet`, `create`, `list`. |
| **Calendar** | `create_event`, `list_events`. |
| **Sistema** | `execute_command` (Shell), `read_file`, `write_file`, `CSV_tools`. |
| **Multimedia** | `web_search`, `text_to_speech` (ElevenLabs + gTTS). |

## ☁️ Despliegue en la Nube (Railway / Cloud)
El agente está diseñado para vivir 24/7 en la nube usando **Docker**.

### ⚓ Configuración de Despliegue:
*   **Docker**: El sistema incluye un `Dockerfile` multietapa que optimiza el tamaño y soporta librerías gráficas (necesarias para procesar PDFs).
*   **Volumen Persistente**: Se debe montar una carpeta en `/app/data` para que `memory.db` y los tokens de Google no se pierdan al reiniciar.
*   **Railway**: Se despliega con un simple `railway up`, configurando un volumen y las variables de entorno.

## 💾 Plantilla de Configuración (.env)
```bash
# Telegram
TELEGRAM_BOT_TOKEN="tus_tokens"
TELEGRAM_ALLOWED_USER_IDS="tu_id"

# Inteligencia (OpenRouter)
OPENROUTER_API_KEY="tu_clave"
OPENROUTER_MODEL="google/gemini-2.0-flash-001"
OPENROUTER_TEXT_MODEL="openai/gpt-4o-mini"

# Google Workspace (OAuth2)
GOOGLE_APPLICATION_CREDENTIALS="./service-account.json"
FIREBASE_PROJECT_ID="tu_proyecto_id"

# Otros
ELEVENLABS_API_KEY="tu_clave_opcional"
DB_PATH="/app/data/memory.db" # Usar esto para despliegue en nube
```

## 📜 Versión del Lector de PDF (Clase PDFParse)
Documentación técnica: Para leer PDFs, usa la clase `PDFParse` del paquete `pdf-parse` (v2+), llamando al método `getText()` para obtener el objeto `{ text, metadata }`.

---
> [!IMPORTANT]
> Para replicar el bot, asegúrate de haber ejecutado `npm run build` o usar el Dockerfile provisto, que garantiza que el código TypeScript se convierta a JavaScript compatible con el servidor.

---
> [!TIP]
> Si el bot de la nube no responde, verifica que no tengas una instancia del bot corriendo en tu PC local (Error 409 Conflict).
