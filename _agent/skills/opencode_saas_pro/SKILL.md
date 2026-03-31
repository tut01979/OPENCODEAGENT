---
name: OpenCode SaaS Pro Builder
description: Arquitectura definitiva para transformar agentes IA en plataformas SaaS multiusuario con suscripciones (Stripe), persistencia distribuida (Firebase) y Google OAuth2 dinámico.
---

# 🚀 OpenCode SaaS Pro: Arquitectura de Escala v3.0

Esta habilidad define el estándar para convertir un bot individual en un negocio **SaaS (Software as a Service)** escalable.

## 🌐 Arquitectura Multiusuario Dinámica (OAuth2)
A diferencia de los bots rígidos, este sistema permite que CUALQUIER usuario conecte su propia cuenta de Google de forma segura:

1.  **🔑 Servidor de Autenticación Express**: 
    *   Levanta un endpoint `/auth/google/callback` para recibir los códigos de autorización.
    *   Detecta automáticamente si corre en local o en **Railway** (`process.env.RAILWAY_PUBLIC_DOMAIN`).
2.  **🛡️ Almacenamiento Seguro (Firebase)**:
    *   Los `refresh_tokens` de cada usuario se guardan en **Firestore** con su `telegramUserId`.
    *   **Master Token Fallback**: Permite al administrador usar un token pre-configurado, mientras los usuarios externos siguen el flujo OAuth.
3.  **🔗 Cortocircuito de Seguridad**: 
    *   El agente intercepta enlaces de autorización (`accounts.google.com`) y los entrega directamente al usuario, evitando que la IA los "resuma" o ignore.

## 💳 Monetización Integrada (Stripe + Trial)
El sistema incluye un motor de pagos diseñado para la conversión:

*   **⚡ Trial Automático**: 7 días de prueba gratuita desde el primer mensaje (persistido en Firebase).
*   **💳 Stripe Checkout**: Generación de enlaces de pago seguros para planes mensuales y anuales.
*   **🛑 Middleware de Suscripción**: Bloqueo automático de herramientas (Gmail, Calendar, Drive) si la suscripción no está activa o el trial ha expirado.

## 🛠️ Herramientas Multi-Contexto
Todas las herramientas han sido refactorizadas para inyectar el `userId` en tiempo de ejecución:

| Herramienta | Lógica SaaS |
| :--- | :--- |
| **Gmail/Calendar** | Busca el token en Firestore usando el `userId` del mensaje de Telegram. |
| **Drive/Sheets** | Aísla los archivos por cuenta de usuario conectada. |
| **Shell/Sistema** | Ejecución controlada con logs específicos por usuario. |

## ☁️ Despliegue en Railway (Producción)
Optimizado para despliegue continuo con herramientas de diagnóstico:

*   **Logs Transparentes**: El sistema está configurado para devolver errores JSON crudos al administrador para depuración rápida (Modo Admin).
*   **Variables de Entorno Críticas**:
    *   `GMAIL_CREDENTIALS_JSON`: JSON de la App de Google Cloud (tipo Web).
    *   `STRIPE_SECRET_KEY`: Para gestionar cobros.
    *   `FIREBASE_SERVICE_ACCOUNT_JSON`: Para persistencia de tokens y usuarios.

## 📜 Instrucciones para el Agente (System Prompt Pro)
Para garantizar que el agente no falle por "pereza" o memoria:
1.  **Obligatoriedad de Herramientas**: Prohibido responder de memoria sobre datos de Google. Siempre llamar a la herramienta.
2.  **Transparencia de Errores**: En caso de fallo, mostrar el error técnico exacto (especialmente al administrador).
3.  **Comando `/clear`**: Imprescindible para limpiar estados de error en el historial del LLM.

---
> [!IMPORTANT]
> Esta arquitectura requiere que el proyecto en Google Cloud Console esté configurado con **Redirect URIs** que apunten a tu dominio de Railway (o localhost para pruebas).

---
> [!TIP]
> Si recibes un error `unauthorized_client`, es probable que tus credenciales JSON sean de tipo "Desktop" y no "Web". Cámbialas en la consola de Google Cloud.
