'use strict';

const express = require('express');
const { stripe } = require('../stripe');
const users = require('../db/users');
const { logOperation, logError } = require('../utils/logger');

const router = express.Router();

// Stripe Webhook は署名検証のため raw body が必要
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logError('stripe.webhook.signature', err);
    return res.status(400).json({ error: 'invalid signature' });
  }

  if (event.type === 'checkout.session.completed') {
    try {
      await handleCheckoutCompleted(event.data.object);
    } catch (err) {
      logError('stripe.checkout.completed', err, { sessionId: event.data.object.id });
      return res.status(500).json({ error: 'internal error' });
    }
  }

  res.json({ received: true });
});

async function handleCheckoutCompleted(session) {
  if (session.mode !== 'setup') return;
  const lineUserId = session.metadata?.line_user_id;
  if (!lineUserId) return;

  const setupIntent = await stripe.setupIntents.retrieve(session.setup_intent);
  const paymentMethodId = setupIntent.payment_method;

  users.saveStripeIds(lineUserId, session.customer, paymentMethodId);
  logOperation('stripe.card.registered', { userId: lineUserId.slice(0, 8) });
}

router.get('/success', (req, res) => {
  res.send(`
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>✅ カード登録が完了しました</h2>
    <p>LINEアプリに戻ってください。</p>
    </body></html>
  `);
});

router.get('/cancel', (req, res) => {
  res.send(`
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:sans-serif;text-align:center;padding:60px">
    <h2>カード登録がキャンセルされました</h2>
    <p>LINEアプリから再度お試しください。</p>
    </body></html>
  `);
});

module.exports = router;
