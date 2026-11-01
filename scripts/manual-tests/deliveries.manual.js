// Delivery and scheduler tests: the clock rules, skips and pauses, the nightly job,
// marking deliveries, completion, auto-cancel and the scheduler's lock.
// Needs the server on :3000 started with JOBS_ENABLED=false (the jobs are called directly here),
// migrations 001-008 and `npm run seed`. Run from the server folder:
//   node scripts/manual-tests/deliveries.manual.js
// Where a test needs time to have passed (a subscription that started two weeks ago, an order
// placed 20 minutes ago), that is simulated with a labelled SQL UPDATE.
require('../../src/config'); // loads .env (SEED_PASSWORD)
const { pool } = require('../../src/db');
const clock = require('../../src/clock');
const { scheduleDeliveries } = require('../../src/jobs/subscriptionDeliveries');
const { cancelUnconfirmedOrders } = require('../../src/jobs/autoCancelOrders');
const { tick, JOB_LOCK_ID } = require('../../src/jobs/scheduler');
const { call, show, note, registerUser, login, placeOrder } = require('./_http');

const SEED_PASSWORD = process.env.SEED_PASSWORD;
const ok = (b) => (b ? 'yes' : 'NO');

async function sqlBlocked(id, label, sql, params) {
  try {
    await pool.query(sql, params);
    console.log(`${id.padEnd(6)} ${label.padEnd(54)} ACCEPTED (unexpected)`);
  } catch (e) {
    console.log(`${id.padEnd(6)} ${label.padEnd(54)} blocked: ${e.constraint ?? e.message}`);
  }
}

const deliveryOf = async (subId, date) => (await pool.query(
  'SELECT id, status, delivery_line FROM subscription_deliveries WHERE subscription_id = $1 AND delivery_date = $2',
  [subId, date])).rows[0] ?? null;

(async () => {
  console.log('\n=== Q1 clock rules (pure functions, fixed inputs)');
  const q = [
    ['isoWeekday(2026-11-01)', clock.isoWeekday('2026-11-01'), 7],
    ['isoWeekday(2026-11-02)', clock.isoWeekday('2026-11-02'), 1],
    ['firstOpenDate(1 Nov, 20:59)', clock.firstOpenDate({ date: '2026-11-01', minutes: 20 * 60 + 59 }), '2026-11-02'],
    ['firstOpenDate(1 Nov, 21:00)', clock.firstOpenDate({ date: '2026-11-01', minutes: 21 * 60 }), '2026-11-03'],
    ['isLocked(2 Nov) at 1 Nov 20:59', clock.isLocked('2026-11-02', { date: '2026-11-01', minutes: 1259 }), false],
    ['isLocked(2 Nov) at 1 Nov 21:00', clock.isLocked('2026-11-02', { date: '2026-11-01', minutes: 1260 }), true],
    ['addDays(2026-02-28, 1)', clock.addDays('2026-02-28', 1), '2026-03-01'],
    ['addDays(2026-12-31, 1)', clock.addDays('2026-12-31', 1), '2027-01-01'],
  ];
  for (const [label, got, want] of q) console.log(`Q1     ${label.padEnd(40)} → ${got} (expected ${want}: ${ok(got === want)})`);

  const customer = await login('seed.customer@example.com', SEED_PASSWORD);
  const vendor = await login('seed.vendor@example.com', SEED_PASSWORD);
  const admin = await login('seed.admin@example.com', SEED_PASSWORD);
  const stranger = await registerUser('deliv.stranger');
  const kora = (await pool.query("SELECT id FROM restaurants WHERE name = 'Seed Koramangala Kitchen'")).rows[0].id;
  const home = (await call('GET', '/addresses', { token: customer.token })).json.addresses.find((a) => a.label === 'Home');
  const now = clock.istNow();
  const today = now.date;
  const firstOpen = clock.firstOpenDate(now);

  // The two leftover test subscriptions from the address tests (A19) deliver every day; cancel them so the
  // job runs below only touch this script's subscriptions (their locked deliveries stay).
  const leftovers = (await pool.query(
    "SELECT s.id FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.status = 'active' AND p.name LIKE 'Test plan %'")).rows;
  for (const { id } of leftovers) await call('POST', `/subscriptions/${id}/cancel`, { token: admin.token, body: { reason: 'Old test data' } });
  note(`cancelled ${leftovers.length} leftover A19 test subscriptions (admin)`);

  const plan = (await call('POST', `/restaurants/${kora}/plans`, {
    token: vendor.token, body: { name: `Test 5B Lunches ${Date.now()}`, mealSlot: 'lunch', mealsCount: 5, pricePaise: 60000 },
  })).json.plan;

  // K-subscription: Mon/Wed/Fri, starting on a Monday at least a week away (clear of the cutoff).
  let start = clock.addDays(firstOpen, 7);
  while (clock.isoWeekday(start) !== 1) start = clock.addDays(start, 1);
  const kSub = (await call('POST', '/subscriptions', {
    token: customer.token, body: { planId: plan.id, addressId: home.id, weekdays: ['mon', 'wed', 'fri'], startDate: start },
  })).json.subscription;
  const d = (n) => clock.addDays(start, n); // start = Monday, d(2) = Wednesday, …
  note(`K-subscription ${kSub.id}: Mon/Wed/Fri from ${start} · projected last ${kSub.projectedLastDate} (= start+9: ${ok(kSub.projectedLastDate === d(9))})`);

  console.log('\n=== K1-K8 skips and pauses');
  show('K1', `skip today (${today})`, await call('POST', `/subscriptions/${kSub.id}/skips`, { token: customer.token, body: { date: today } }));
  show('K2', `skip ${d(1)} (a Tuesday: not a delivery day)`, await call('POST', `/subscriptions/${kSub.id}/skips`, { token: customer.token, body: { date: d(1) } }));
  const k3 = await call('POST', `/subscriptions/${kSub.id}/skips`, { token: customer.token, body: { date: d(2) } });
  show('K3', `skip ${d(2)} (Wednesday)`, k3, `→ kind ${k3.json.kind}, projected last ${k3.json.subscription?.projectedLastDate} (= start+11: ${ok(k3.json.subscription?.projectedLastDate === d(11))})`);
  const k4 = await call('POST', `/subscriptions/${kSub.id}/skips`, { token: customer.token, body: { date: d(2) } });
  show('K4', 'skip the same day again', k4, `→ skipped ${JSON.stringify(k4.json.skipped)}, alreadySkipped ${JSON.stringify(k4.json.alreadySkipped)}`);
  const k5 = await call('POST', `/subscriptions/${kSub.id}/skips`, { token: customer.token, body: { from: d(7), to: d(13) } });
  show('K5', `pause ${d(7)} … ${d(13)} (all of week 2)`, k5,
    `\n       → kind ${k5.json.kind}, skipped ${JSON.stringify(k5.json.skipped)}, projected last ${k5.json.subscription?.projectedLastDate} (= start+18: ${ok(k5.json.subscription?.projectedLastDate === d(18))})`);
  show('K6a', 'pause of 61 days', await call('POST', `/subscriptions/${kSub.id}/skips`, { token: customer.token, body: { from: d(20), to: d(80) } }));
  show('K6b', '"to" before "from"', await call('POST', `/subscriptions/${kSub.id}/skips`, { token: customer.token, body: { from: d(21), to: d(20) } }));
  show('K6c', 'both "date" and "from" in the body', await call('POST', `/subscriptions/${kSub.id}/skips`, { token: customer.token, body: { date: d(21), from: d(21) } }));
  show('K7a', 'the vendor tries to skip', await call('POST', `/subscriptions/${kSub.id}/skips`, { token: vendor.token, body: { date: d(4) } }));
  show('K7b', 'another customer tries to skip', await call('POST', `/subscriptions/${kSub.id}/skips`, { token: stranger.token, body: { date: d(4) } }));
  show('K8a', `un-skip ${d(2)}`, await call('DELETE', `/subscriptions/${kSub.id}/skips/${d(2)}`, { token: customer.token }));
  note(`projected last now ${(await call('GET', `/subscriptions/${kSub.id}`, { token: customer.token })).json.subscription.projectedLastDate} (= start+16: Mon, Wed, Fri, then week 3 Mon, Wed)`);
  show('K8b', 'un-skip it again', await call('DELETE', `/subscriptions/${kSub.id}/skips/${d(2)}`, { token: customer.token }));
  show('K8c', 'un-skip today', await call('DELETE', `/subscriptions/${kSub.id}/skips/${today}`, { token: customer.token }));

  console.log('\n=== J1-J5 the nightly job (called directly for chosen dates)');
  const j1 = await scheduleDeliveries(start);
  const kDel = await deliveryOf(kSub.id, start);
  console.log(`J1     job for ${start} (Monday)                       → ${JSON.stringify(j1)} · K-subscription got one: ${ok(!!kDel)} · address snapshot "${kDel?.delivery_line}"`);
  const j2 = await scheduleDeliveries(start);
  console.log(`J2     the same date again                                   → ${JSON.stringify(j2)} (created 0: ${ok(j2.created === 0)})`);
  await scheduleDeliveries(d(7));
  console.log(`J3     job for ${d(7)} (paused Monday)                 → K-subscription got one: ${ok(!!(await deliveryOf(kSub.id, d(7))))} (expected NO)`);
  show('J4', `skip ${start}: the clock says open, the job has locked it`, await call('POST', `/subscriptions/${kSub.id}/skips`, { token: customer.token, body: { date: start } }));
  await scheduleDeliveries(d(1));
  console.log(`J5     job for ${d(1)} (Tuesday)                       → K-subscription got one: ${ok(!!(await deliveryOf(kSub.id, d(1))))} (expected NO)`);

  console.log('\n=== W1-W10 deliveries, missed meals, completion');
  // W-subscription: every weekday except today's, 5 meals. Simulated: it started 13 days ago.
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter((_, i) => i + 1 !== clock.isoWeekday(today));
  const plan2 = (await call('POST', `/restaurants/${kora}/plans`, {
    token: vendor.token, body: { name: `Test 5B-W Lunches ${Date.now()}`, mealSlot: 'lunch', mealsCount: 5, pricePaise: 60000 },
  })).json.plan;
  const wSub = (await call('POST', '/subscriptions', { token: customer.token, body: { planId: plan2.id, addressId: home.id, weekdays: days } })).json.subscription;
  await pool.query('UPDATE subscriptions SET start_date = $2 WHERE id = $1', [wSub.id, clock.addDays(today, -13)]);
  note(`W-subscription ${wSub.id}: ${days.join(',')}, 5 meals; SQL: start_date moved to ${clock.addDays(today, -13)} (simulating two weeks)`);
  const past = [];
  for (let x = clock.addDays(today, -13); x < today; x = clock.addDays(x, 1)) if (clock.isoWeekday(x) !== clock.isoWeekday(today)) past.push(x);
  for (const date of past.slice(0, 5)) await scheduleDeliveries(date);
  await scheduleDeliveries(past[5]);
  const wRows = (await pool.query('SELECT id, delivery_date FROM subscription_deliveries WHERE subscription_id = $1 ORDER BY delivery_date', [wSub.id])).rows;
  note(`job run for 6 past dates: deliveries created ${wRows.length} (5 meals, so the 6th date got none: ${ok(wRows.length === 5)})`);
  const w1 = await call('GET', `/restaurants/${kora}/deliveries?date=${wRows[0].delivery_date}`, { token: vendor.token });
  show('W1', `vendor head-count for ${wRows[0].delivery_date}`, w1, `→ totals ${JSON.stringify(w1.json.totals)}, includes W-sub: ${ok(w1.json.deliveries?.some((x) => x.subscriptionId === wSub.id))}`);
  show('W2', `mark K-sub's ${start} delivery (future) delivered`, await call('PATCH', `/deliveries/${kDel.id}/status`, { token: vendor.token, body: { status: 'delivered' } }));
  show('W3a', 'the customer marks their own delivery', await call('PATCH', `/deliveries/${wRows[0].id}/status`, { token: customer.token, body: { status: 'delivered' } }));
  show('W3b', 'a stranger marks it', await call('PATCH', `/deliveries/${wRows[0].id}/status`, { token: stranger.token, body: { status: 'delivered' } }));
  for (const r of wRows.slice(0, 4)) await call('PATCH', `/deliveries/${r.id}/status`, { token: vendor.token, body: { status: 'delivered' } });
  const w4 = await call('PATCH', `/deliveries/${wRows[4].id}/status`, { token: vendor.token, body: { status: 'missed' } });
  const afterMiss = (await call('GET', `/subscriptions/${wSub.id}`, { token: customer.token })).json.subscription;
  show('W4', '4 delivered + the 5th marked missed', w4, `→ status ${afterMiss.status}, progress ${JSON.stringify(afterMiss.progress)}`);
  await scheduleDeliveries(past[6]);
  const resched = await deliveryOf(wSub.id, past[6]);
  console.log(`W5     job for ${past[6]}: missed meal rescheduled              → ${ok(!!resched)}`);
  const w6 = await call('PATCH', `/deliveries/${resched.id}/status`, { token: vendor.token, body: { status: 'delivered' } });
  const done = (await call('GET', `/subscriptions/${wSub.id}`, { token: customer.token })).json.subscription;
  show('W6', 'the rescheduled meal delivered', w6, `→ status ${done.status}, endDate ${done.endDate} (= ${past[6]}: ${ok(done.endDate === past[6])}), progress ${JSON.stringify(done.progress)}`);
  show('W7', 'mark it again', await call('PATCH', `/deliveries/${resched.id}/status`, { token: vendor.token, body: { status: 'missed' } }));
  await scheduleDeliveries(past[7]);
  console.log(`W8     job for ${past[7]} after completion → W-sub got one: ${ok(!!(await deliveryOf(wSub.id, past[7])))} (expected NO)`);
  show('W9', 'skip on the completed subscription', await call('POST', `/subscriptions/${wSub.id}/skips`, { token: customer.token, body: { date: d(4) } }));
  const w10 = await call('POST', `/subscriptions/${kSub.id}/cancel`, { token: customer.token });
  await scheduleDeliveries(d(4));
  show('W10', 'cancel K-sub (it has a locked delivery)', w10,
    `→ locked ${start} delivery still ${(await deliveryOf(kSub.id, start)).status}; job for ${d(4)} created one: ${ok(!!(await deliveryOf(kSub.id, d(4))))} (expected NO)`);

  console.log('\n=== X1-X4 auto-cancel and the scheduler lock');
  const kora2 = { restaurantId: kora, addressId: home.id, items: [{ menuItemId: (await pool.query("SELECT id FROM menu_items WHERE restaurant_id = $1 AND name = 'Masala Dosa'", [kora])).rows[0].id, quantity: 1 }] };
  const stale = (await placeOrder(customer.token, kora2)).json.order.id;
  const fresh = (await placeOrder(customer.token, kora2)).json.order.id;
  await pool.query("UPDATE orders SET created_at = now() - interval '20 minutes' WHERE id = $1", [stale]);
  note(`orders ${stale} (SQL: placed 20 minutes ago) and ${fresh} (just placed)`);
  const cancelled = await cancelUnconfirmedOrders();
  const x1 = await call('GET', `/orders/${stale}`, { token: customer.token });
  const last = x1.json.order.history.at(-1);
  show('X1', 'auto-cancel job', x1, `→ cancelled ${JSON.stringify(cancelled)}; ${stale}: ${x1.json.order.status} by ${last.actor}, user ${last.changedByUserId}, "${last.note}"; ${fresh} still ${(await call('GET', `/orders/${fresh}`, { token: customer.token })).json.order.status}`);
  show('X2', 'the vendor confirms the auto-cancelled order', await call('PATCH', `/orders/${stale}/status`, { token: vendor.token, body: { status: 'confirmed' } }));
  await sqlBlocked('X3a', "history: actor 'system' with a user id",
    "INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor) VALUES ($1, 'pending', 'cancelled', $2, 'system')", [fresh, customer.id]);
  await sqlBlocked('X3b', "history: actor 'customer' with no user",
    "INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, actor) VALUES ($1, 'pending', 'cancelled', NULL, 'customer')", [fresh]);
  await pool.query("UPDATE orders SET created_at = now() - interval '20 minutes' WHERE id = $1", [fresh]);
  const holder = await pool.connect();
  await holder.query('SELECT pg_advisory_lock($1)', [JOB_LOCK_ID]);
  await tick();
  const whileLocked = (await call('GET', `/orders/${fresh}`, { token: customer.token })).json.order.status;
  await holder.query('SELECT pg_advisory_unlock($1)', [JOB_LOCK_ID]);
  holder.release();
  await tick();
  const afterUnlock = (await call('GET', `/orders/${fresh}`, { token: customer.token })).json.order.status;
  console.log(`X4     tick while another session holds the job lock → order ${fresh} ${whileLocked}; after unlock → ${afterUnlock}`);

  console.log(`\nTest data: plans ${plan.id}, ${plan2.id}; subscriptions ${kSub.id} (cancelled), ${wSub.id} (completed); orders ${stale}, ${fresh}; user ${stranger.email}`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
