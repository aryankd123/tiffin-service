// The one payment gateway this process uses, chosen by config. The rest of the code talks
// only to this interface: createOrder, fetchPayments, capture, refund, findRefund,
// verifyCheckout, verifyWebhook — never to Razorpay directly.
const config = require('../config');
const { createRazorpayGateway } = require('./razorpayGateway');
const { createFakeGateway } = require('./fakeGateway');

const gateway = config.PAYMENT_PROVIDER === 'razorpay'
  ? createRazorpayGateway({
    keyId: config.RAZORPAY_KEY_ID,
    keySecret: config.RAZORPAY_KEY_SECRET,
    webhookSecret: config.RAZORPAY_WEBHOOK_SECRET,
  })
  : createFakeGateway();

module.exports = { gateway };
