'use strict';

const Stripe = require('stripe');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function createCheckoutSession(lineUserId) {
  const customer = await stripe.customers.create({
    metadata: { line_user_id: lineUserId },
  });

  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    customer: customer.id,
    payment_method_types: ['card'],
    success_url: `${process.env.APP_BASE_URL}/stripe/success`,
    cancel_url: `${process.env.APP_BASE_URL}/stripe/cancel`,
    metadata: { line_user_id: lineUserId },
  });

  return { url: session.url, customerId: customer.id };
}

// Stripe は JPY を整数（円単位）で受け取る
async function chargeCard(stripeCustomerId, paymentMethodId, amountYen, description) {
  return stripe.paymentIntents.create({
    amount: amountYen,
    currency: 'jpy',
    customer: stripeCustomerId,
    payment_method: paymentMethodId,
    confirm: true,
    off_session: true,
    description,
  });
}

module.exports = { stripe, createCheckoutSession, chargeCard };
