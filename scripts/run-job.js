// Runs a scheduled job by hand (the server's scheduler runs them automatically).
// Usage (from the server folder):
//   npm run job -- deliveries                     today and, after 9 PM, tomorrow (like the scheduler)
//   npm run job -- deliveries --date 2026-11-05   one specific date
//   npm run job -- auto-cancel                    cancel orders unconfirmed for 15 minutes
//   npm run job -- payments                       check unpaid orders with the gateway; expire old ones
//   npm run job -- refunds                        send requested refunds to the gateway
// With PAYMENT_PROVIDER=fake the gateway lives in memory, so "payments" and "refunds" are only
// meaningful inside the server process (use POST /api/v1/dev/jobs/:job there).
const { pool } = require('../src/db');
const clock = require('../src/clock');
const { scheduleDeliveries } = require('../src/jobs/subscriptionDeliveries');
const { cancelUnconfirmedOrders } = require('../src/jobs/autoCancelOrders');
const { reconcileAndExpireOrders, processRefunds } = require('../src/services/paymentService');

async function main() {
  const [job, flag, value] = process.argv.slice(2);
  if (job === 'deliveries') {
    let dates;
    if (flag === '--date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error('--date needs YYYY-MM-DD');
      dates = [value];
    } else {
      const now = clock.istNow();
      dates = [now.date];
      if (now.minutes >= clock.CUTOFF_MINUTES) dates.push(clock.addDays(now.date, 1));
    }
    for (const date of dates) console.log(JSON.stringify(await scheduleDeliveries(date)));
  } else if (job === 'auto-cancel') {
    console.log(JSON.stringify(await cancelUnconfirmedOrders()));
  } else if (job === 'payments') {
    console.log(JSON.stringify(await reconcileAndExpireOrders()));
  } else if (job === 'refunds') {
    console.log(JSON.stringify(await processRefunds()));
  } else {
    console.error('usage: npm run job -- deliveries [--date YYYY-MM-DD] | auto-cancel | payments | refunds');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
