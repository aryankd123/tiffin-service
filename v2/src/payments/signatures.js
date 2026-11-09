const crypto = require('node:crypto');

// HMAC-SHA256 as lowercase hex, the format Razorpay uses for checkout and webhook signatures.
function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

// Compares in constant time, so the response time doesn't reveal how many leading characters
// of a forged signature were right.
function safeEqual(expectedHex, givenHex) {
  if (typeof givenHex !== 'string' || givenHex.length !== expectedHex.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHex), Buffer.from(givenHex));
}

// Checkout: Razorpay signs "<order_id>|<payment_id>" with the key secret.
function checkoutSignatureValid(secret, gatewayOrderId, gatewayPaymentId, signature) {
  return safeEqual(hmacHex(secret, `${gatewayOrderId}|${gatewayPaymentId}`), signature);
}

// Webhooks: Razorpay signs the raw request body with the webhook secret.
function webhookSignatureValid(secret, rawBody, signature) {
  return safeEqual(hmacHex(secret, rawBody), signature);
}

module.exports = { hmacHex, checkoutSignatureValid, webhookSignatureValid };
