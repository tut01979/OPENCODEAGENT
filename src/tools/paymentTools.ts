import { Tool } from './types.js';
import { payments } from '../services/payments.js';

export const getSubscriptionLinkTool: Tool = {
  name: 'get_subscription_link',
  description: 'Generates a Stripe checkout link for a monthly or yearly subscription plan.',
  parameters: {
    type: 'object',
    properties: {
      plan: {
        type: 'string',
        enum: ['monthly', 'yearly'],
        description: 'The subscription plan to offer (monthly for €20/month or yearly for €192/year).',
      },
    },
    required: ['plan'],
  },
  execute: async (args: any, userId) => {
    try {
      const plan = args.plan as 'monthly' | 'yearly';
      const session = await payments.createCheckoutSession(userId, plan);
      if (!session.url) {
        throw new Error('No se pudo generar el enlace de pago.');
      }
      return `💳 **SUSCRIPCIÓN ${plan.toUpperCase()}** 💳\n\nHas elegido el plan ${plan}. Haz clic en el enlace para completar el pago de forma segura con Stripe:\n\n🔗 ${session.url}\n\n(Incluye una prueba gratuita de 7 días)`.trim();
    } catch (error) {
      return `Error al generar el enlace de suscripción: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
};

export const checkSubscriptionStatusTool: Tool = {
  name: 'check_subscription_status',
  description: 'Checks if the current user has an active subscription.',
  parameters: {
    type: 'object',
    properties: {},
  },
  execute: async (_, userId) => {
    const isActive = await payments.isSubscriptionActive(userId);
    return isActive 
      ? '✅ Tu suscripción está ACTIVA. Tienes acceso completo a todas las herramientas.'
      : '❌ No se detectó una suscripción activa o tu periodo de prueba ha expirado. ¡Suscríbete para continuar!';
  },
};
