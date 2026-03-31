import Stripe from 'stripe';
import { firebase } from './firebase.js';
import { config } from '../config.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
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
    const userData = await firebase.getUserData(userId);
    if (!userData) return false;

    // Si es Admin, siempre activo
    if (userId === process.env.ADMIN_TELEGRAM_ID) return true;

    // Verificar si está en periodo de prueba (7 días desde registro)
    const now = Date.now();
    const trialEnd = userData.trial_ends_at || 0;
    if (now < trialEnd) return true;

    // Verificar estado de suscripción en Firestore (actualizado por Webhooks)
    return userData.subscription_status === 'active';
  }
};
