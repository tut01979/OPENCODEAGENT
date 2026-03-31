---
name: OpenCode SaaS Master Pro Builder
description: Habilidad maestra para transformar cualquier bot individual en una plataforma SaaS multi-usuario completa con pagos (Stripe), persistencia (Firebase) y OAuth2 dinámico.
---

# 🚀 OpenCode SaaS Master Pro: Guía de Arquitectura v3.1

Esta habilidad es el estándar definitivo para la creación de plataformas SaaS basadas en agentes IA de OpenCode.

## 📋 Requisitos de Arquitectura
Para que la transformación a SaaS sea exitosa, el agente debe seguir estos pasos técnicos:

### 1. Refactorización de Herramientas (Multi-Tenancy)
*   Modificar el método `execute` de todas las herramientas para aceptar un parámetro `userId: string`.
*   Ejemplo: `execute: async (params, userId) => { ... }`.
*   Esto garantiza que cada usuario use sus propias credenciales y datos.

### 2. Persistencia con Firebase (Firestore)
*   Utilizar Firebase para almacenar los tokens de OAuth2 y los datos de suscripción.
*   Estructura recomendada en Firestore: `/users/{userId}/tokens` y `/users/{userId}/subscription`.
*   Implementar un `Master Token Fallback` en las herramientas de Google para que el administrador no necesite loguearse constantemente.

### 3. Servidor de Autenticación Express
*   Levantar un servidor Express en el puerto `process.env.PORT || 8080` (estándar de Railway).
*   Endpoint crítico: `/auth/google/callback`. Debe manejar el parámetro `state` para vincular el código de Google con el `userId` de Telegram.

### 4. Motor de Pagos (Stripe)
*   **Trial de 7 días:** Al registrar a un nuevo usuario, marcar en la DB la fecha de fin de trial (`Date.now() + 7 * 24 * 60 * 60 * 1000`).
*   **Planes:** 
    *   **Mensual:** Suscripción estándar.
    *   **Anual:** Con descuento (20% recomendado).
*   **Middleware de Suscripción:** Antes de cada `execute` de herramienta sensible, verificar si `isSubscriptionActive(userId)` devuelve `true`.

## 🛠️ Flujo de Despliegue en Railway
*   **Docker:** Utilizar un Dockerfile multietapa para soportar librerías de sistema (canvas, cairo, pango).
*   **Variables de Entorno:**
    *   `GMAIL_CREDENTIALS_JSON`: JSON de credenciales de Google (tipo Web).
    *   `STRIPE_SECRET_KEY`: Clave secreta de Stripe.
    *   `FIREBASE_SERVICE_ACCOUNT_JSON`: Token de Firebase.
    *   `RAILWAY_PUBLIC_DOMAIN`: Para generar URLs de callback dinámicas.

## 📜 Reglas de Interacción del Agente
1.  **Prioridad de Herramientas:** NUNCA respondas sobre datos de Google sin llamar a la herramienta. La "pereza" del LLM se combate obligando al uso de tools.
2.  **Gestión de Memoria:** Si ocurren errores de autenticación, sugerir al usuario el comando `/clear` para resetear el historial envenenado.
3.  **Transparencia:** Mostrar siempre errores técnicos al administrador para facilitar el soporte técnico del SaaS.

---
> [!IMPORTANT]
> Siempre realiza un `npm run build` antes de desplegar para asegurar que la tipificación del `userId` sea consistente en todo el proyecto.
