import Stripe from 'stripe';
import { firebase } from './firebase.js';
import { config } from '../config.js';

const stripeKey = config.payments.stripeSecretKey;
if (!stripeKey || stripeKey.includes('REEMPLAZAR')) {
  console.warn('⚠️ Stripe API Key no configurada o es un placeholder. Los pagos fallarán.');
}

const stripe = new Stripe(stripeKey || 'sk_test_placeholder', {
  apiVersion: '2025-01-27' as any,
});

export const payments = {
  async createCheckoutSession(userId: string, plan: 'monthly' | 'yearly') {
    const priceId = plan === 'monthly' ? process.env.STRIPE_PRICE_MONTHLY : process.env.STRIPE_PRICE_YEARLY;
    
    return await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `https://t.me/${config.telegram.botUsername}?start=success`,
      cancel_url: `https://t.me/${config.telegram.botUsername}?start=cancel`,
      client_reference_id: userId,
      subscription_data: {
        trial_period_days: 7,
      }
    });
  },

  async isSubscriptionActive(userId: string): Promise<boolean> {
    // Si es Admin, siempre activo
    if (userId === process.env.ADMIN_TELEGRAM_ID || userId === config.telegram.adminId) return true;

    let userData = await firebase.getUserData(userId);
    
    // Si no existe, creamos su periodo de prueba inicial (7 días)
    if (!userData) {
      userData = {
        trial_ends_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
        subscription_status: 'none',
      };
      await firebase.updateUserData(userId, userData);
      console.log(`🎁 Iniciado periodo de prueba de 7 días para el nuevo usuario: ${userId}`);
    }

    // Verificar si está en periodo de prueba
    const now = Date.now();
    const trialEnd = userData.trial_ends_at || 0;
    if (now < trialEnd) return true;

    // Verificar estado de suscripción en Firestore (actualizado por Webhooks)
    return userData.subscription_status === 'active';
  }
};
