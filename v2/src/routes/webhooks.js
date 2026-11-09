// Razorpay webhooks. No login: Razorpay calls this URL. The signature over the raw body is
// the authentication, so the body must reach the check byte for byte. That's why it is read with
// express.raw here and this router is mounted before express.json in app.js.
const express = require('express');
const { z } = require('zod');
const webhookService = require('../services/webhookService');

const router = express.Router();

const headerSchema = z.object({
  'x-razorpay-signature': z.string().max(200).optional(),
  'x-razorpay-event-id': z.string().min(1).max(100).optional(),
});

router.post('/webhook', express.raw({ type: 'application/json', limit: '100kb' }), async (req, res) => {
  const headers = headerSchema.parse(req.headers);
  const result = await webhookService.handleWebhook({
    rawBody: req.body, // a Buffer, or undefined if the content type wasn't JSON
    signature: headers['x-razorpay-signature'],
    eventId: headers['x-razorpay-event-id'],
  });
  res.json({ received: true, ...result });
});

module.exports = router;
