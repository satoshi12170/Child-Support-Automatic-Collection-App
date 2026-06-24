'use strict';

require('dotenv').config();

const express = require('express');
const { router: webhookRouter, client } = require('./routes/webhook');
const stripeRouter = require('./routes/stripeWebhook');
const { startJobs } = require('./jobs/reminders');
const { setupRichMenus } = require('./line/richMenu');
const { logger } = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Stripe Webhook（raw body が必要なため /webhook より前にマウント）
app.use('/stripe', stripeRouter);

// Webhookルート（LINE Signature検証はルーター内で実施）
app.use('/webhook', webhookRouter);

app.listen(PORT, () => {
  logger.info('Server started', { port: PORT, webhook: 'POST /webhook' });
  startJobs();
  setupRichMenus(client);
});

module.exports = app;
