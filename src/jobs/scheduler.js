// Runs the scheduled jobs once a minute inside the API server.
// - Only one server instance acts per tick: it must win a Postgres advisory lock first.
// - Every job is safe to repeat, so a tick that runs twice, late, or after a restart does no harm.
// - Missed runs catch up: from 9 PM every tick ensures tomorrow's deliveries exist, and every
//   tick ensures today's exist (in case the server was down at 9 PM).
const { pool } = require('../db');
const logger = require('../logger');
const clock = require('../clock');
const { scheduleDeliveries } = require('./subscriptionDeliveries');
const { cancelUnconfirmedOrders } = require('./autoCancelOrders');
const { reconcileAndExpireOrders, processRefunds } = require('../services/paymentService');

const JOB_LOCK_ID = 727275; // the migration runner uses 727274
const TICK_MS = 60 * 1000;

async function runDueJobs() {
  // Payments first: a payment found by the status check makes its order 'pending' in this tick.
  const payments = await reconcileAndExpireOrders();
  if (payments.paid + payments.expired + payments.errors > 0) {
    logger.info(payments, 'job: order payments checked');
  }
  const { cancelled, refundsRequested } = await cancelUnconfirmedOrders();
  if (cancelled.length > 0) {
    logger.info({ count: cancelled.length, refundsRequested }, 'job: unconfirmed orders cancelled');
  }
  // Refunds last, so those requested by this tick's cancellations go out immediately.
  const refunds = await processRefunds();
  if (refunds.checked > 0) logger.info(refunds, 'job: refunds processed');
  const now = clock.istNow();
  const dates = [now.date];
  if (now.minutes >= clock.CUTOFF_MINUTES) dates.push(clock.addDays(now.date, 1));
  for (const date of dates) {
    const result = await scheduleDeliveries(date);
    if (result.created > 0) logger.info(result, 'job: subscription deliveries scheduled');
  }
}

async function tick() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS got', [JOB_LOCK_ID]);
    if (!rows[0].got) return; // another instance is running the jobs right now
    try {
      await runDueJobs();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [JOB_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}

function startScheduler() {
  const run = () => tick().catch((err) => logger.error({ err }, 'job tick failed'));
  run();
  const timer = setInterval(run, TICK_MS);
  return { stop: () => clearInterval(timer) };
}

module.exports = { startScheduler, runDueJobs, tick, JOB_LOCK_ID };
