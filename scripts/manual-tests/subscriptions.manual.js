// Subscription tests: plans, subscribing, viewing, cancelling.
// Needs the server on :3000 (started with JOBS_ENABLED=false so scheduled jobs stay out of the
// way), migrations 001-008 applied and `npm run seed` done. Run from the server folder:
//   node scripts/manual-tests/subscriptions.manual.js
require('../../src/config'); // loads .env (SEED_PASSWORD)
const { pool } = require('../../src/db');
const clock = require('../../src/clock');
const { call, show, note, registerUser, login } = require('./_http');

const SEED_PASSWORD = process.env.SEED_PASSWORD;
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function sqlBlocked(id, label, sql, params) {
  try {
    await pool.query(sql, params);
    console.log(`${id.padEnd(6)} ${label.padEnd(54)} ACCEPTED (unexpected)`);
  } catch (e) {
    console.log(`${id.padEnd(6)} ${label.padEnd(54)} blocked: ${e.constraint ?? e.message}`);
  }
}

(async () => {
  const customer = await login('seed.customer@example.com', SEED_PASSWORD);
  const vendor = await login('seed.vendor@example.com', SEED_PASSWORD);
  const admin = await login('seed.admin@example.com', SEED_PASSWORD);
  const rid = async (name) => (await pool.query('SELECT id FROM restaurants WHERE name = $1', [name])).rows[0].id;
  const kora = await rid('Seed Koramangala Kitchen');
  const cp = await rid('Seed Connaught Place Thali');
  const addrs = (await call('GET', '/addresses', { token: customer.token })).json.addresses;
  const home = addrs.find((a) => a.label === 'Home');
  const parents = addrs.find((a) => a.label === 'Parents (Delhi)');
  const now = clock.istNow();
  const firstOpen = clock.firstOpenDate(now);
  note(`IST now ${now.date} ${hhmm(now.minutes)} · first open date ${firstOpen} (cutoff 21:00)`);

  console.log('\n=== V1-V7 plans');
  const v1 = await call('GET', `/restaurants/${kora}/plans`);
  show('V1', 'public GET /restaurants/:id/plans (Koramangala)', v1,
    `\n       → ${v1.json.plans.map((p) => `${p.name}: ${p.mealSlot}, ${p.mealsCount} meals, ₹${p.pricePaise / 100} (₹${p.pricePerMealPaise / 100}/meal)`).join(' | ')}`);
  const planName = `Test 5 Lunches ${Date.now()}`;
  const planBody = { name: planName, mealSlot: 'lunch', mealsCount: 5, pricePaise: 60000 };
  const v2 = await call('POST', `/restaurants/${kora}/plans`, { token: vendor.token, body: planBody });
  show('V2', 'vendor creates a 5-lunch plan, ₹600', v2);
  const planId = v2.json.plan.id;
  show('V3', 'the same plan name again', await call('POST', `/restaurants/${kora}/plans`, { token: vendor.token, body: planBody }));
  show('V4a', 'mealsCount 61', await call('POST', `/restaurants/${kora}/plans`, { token: vendor.token, body: { ...planBody, name: 'x61', mealsCount: 61 } }));
  show('V4b', "mealSlot 'breakfast'", await call('POST', `/restaurants/${kora}/plans`, { token: vendor.token, body: { ...planBody, name: 'xb', mealSlot: 'breakfast' } }));
  show('V5', 'a customer creates a plan', await call('POST', `/restaurants/${kora}/plans`, { token: customer.token, body: { ...planBody, name: 'xc' } }));
  const cpPlan = (await pool.query('SELECT id FROM subscription_plans WHERE restaurant_id = $1 ORDER BY id LIMIT 1', [cp])).rows[0].id;
  show('V6', "a Connaught Place plan via Koramangala's URL", await call('PATCH', `/restaurants/${kora}/plans/${cpPlan}`, { token: vendor.token, body: { pricePaise: 100 } }));
  show('V7', 'PATCH mealsCount (fixed once created)', await call('PATCH', `/restaurants/${kora}/plans/${planId}`, { token: vendor.token, body: { mealsCount: 10 } }));

  console.log('\n=== U1-U5 subscribing');
  const u1 = await call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: home.id, weekdays: ['fri', 'mon', 'wed'] } });
  show('U1', 'subscribe: 5 lunches, Home, Mon/Wed/Fri', u1);
  const sub = u1.json.subscription;
  note(`startDate ${sub.startDate} (first open date: ${sub.startDate === firstOpen}) · weekdays ${sub.weekdays.join(',')} · progress ${JSON.stringify(sub.progress)}`);
  note(`next delivery dates ${sub.nextDeliveryDates.join(', ')} · all Mon/Wed/Fri: ${sub.nextDeliveryDates.every((d) => [1, 3, 5].includes(clock.isoWeekday(d)))} · projected last ${sub.projectedLastDate}`);
  note(`plan snapshot ${JSON.stringify(sub.plan)}`);
  show('U2', 'the same plan + address again', await call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: home.id, weekdays: ['tue'] } }));
  show('U3', 'Koramangala plan for the Delhi address', await call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: parents.id, weekdays: ['mon'] } }));
  show('U4a', `startDate = today (${now.date})`, await call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: parents.id, weekdays: ['mon'], startDate: now.date } }));
  show('U4b', 'startDate 40 days ahead', await call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: home.id, weekdays: ['mon'], startDate: clock.addDays(now.date, 40) } }));
  show('U4c', "startDate '2026-02-30'", await call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: home.id, weekdays: ['mon'], startDate: '2026-02-30' } }));
  show('U5a', 'weekdays []', await call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: home.id, weekdays: [] } }));
  show('U5b', "weekdays ['mon','mon']", await call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: home.id, weekdays: ['mon', 'mon'] } }));
  show('U5c', "weekdays ['funday']", await call('POST', '/subscriptions', { token: customer.token, body: { planId, addressId: home.id, weekdays: ['funday'] } }));

  console.log('\n=== U6-U8 plan changes, snapshots, who may see');
  const other = await registerUser('subs.other');
  const otherHome = (await call('POST', '/addresses', { token: other.token, body: { label: 'Home', contactName: 'Other', contactPhone: '9876543210', line1: 'MG Road', postalCode: '560001', cityId: '1', location: { lat: 12.9716, lng: 77.5946 } } })).json.address;
  await call('PATCH', `/restaurants/${kora}/plans/${planId}`, { token: vendor.token, body: { isActive: false } });
  show('U6a', 'plan switched off: a new customer subscribes', await call('POST', '/subscriptions', { token: other.token, body: { planId, addressId: otherHome.id, weekdays: ['mon'] } }));
  note(`existing subscription after switch-off: ${(await call('GET', `/subscriptions/${sub.id}`, { token: customer.token })).json.subscription.status}`);
  await call('PATCH', `/restaurants/${kora}/plans/${planId}`, { token: vendor.token, body: { isActive: true, pricePaise: 99900 } });
  const u7 = await call('GET', `/subscriptions/${sub.id}`, { token: customer.token });
  show('U7', 'vendor raises the plan price to ₹999', u7, `→ subscription keeps price ${u7.json.subscription.plan.pricePaise}`);
  await call('PATCH', `/restaurants/${kora}/plans/${planId}`, { token: vendor.token, body: { pricePaise: 60000 } });
  const list = await call('GET', '/subscriptions', { token: customer.token });
  show('U8a', 'GET /subscriptions (customer)', list, `→ ${list.json.subscriptions.length} subscriptions, newest ${list.json.subscriptions[0].plan.name}`);
  show('U8b', 'another customer GETs it', await call('GET', `/subscriptions/${sub.id}`, { token: other.token }));
  show('U8c', "the restaurant's vendor GETs it", await call('GET', `/subscriptions/${sub.id}`, { token: vendor.token }));
  show('U8d', 'an admin GETs it', await call('GET', `/subscriptions/${sub.id}`, { token: admin.token }));

  console.log('\n=== U9-U11 several subscriptions, cancelling');
  const dinners = (await pool.query("SELECT id FROM subscription_plans WHERE restaurant_id = $1 AND name = '20 Dinners'", [kora])).rows[0].id;
  const u9 = await call('POST', '/subscriptions', { token: customer.token, body: { planId: dinners, addressId: home.id, weekdays: ['sat', 'sun'] } });
  show('U9', 'a second subscription: 20 Dinners, same address', u9);
  const u10 = await call('POST', `/subscriptions/${u9.json.subscription.id}/cancel`, { token: customer.token, body: { reason: 'Moving out' } });
  show('U10a', 'customer cancels it, reason "Moving out"', u10, `→ ${JSON.stringify(u10.json.subscription?.cancelled)}`);
  show('U10b', 'cancel it again', await call('POST', `/subscriptions/${u9.json.subscription.id}/cancel`, { token: customer.token }));
  const again = await call('POST', '/subscriptions', { token: customer.token, body: { planId: dinners, addressId: home.id, weekdays: ['sat'] } });
  show('U10c', 'subscribe again to the same plan + address', again);
  const u11 = await call('POST', `/subscriptions/${again.json.subscription.id}/cancel`, { token: vendor.token });
  show('U11', 'the vendor cancels a customer subscription', u11, `→ by ${u11.json.subscription?.cancelled?.by}`);

  console.log('\n=== U12 database backstops (direct SQL)');
  await sqlBlocked('U12a', 'second ACTIVE subscription, same plan + address',
    `INSERT INTO subscriptions (user_id, plan_id, address_id, plan_name_snapshot, price_paise_snapshot, meal_slot, meals_total, delivery_weekdays, start_date)
     VALUES ($1, $2, $3, 'x', 100, 'lunch', 5, '{1}', $4)`, [customer.id, planId, home.id, firstOpen]);
  await sqlBlocked('U12b', 'weekday 8',
    'UPDATE subscriptions SET delivery_weekdays = \'{1,8}\' WHERE id = $1', [sub.id]);
  await sqlBlocked('U12c', "status 'cancelled' without cancelled_at",
    "UPDATE subscriptions SET status = 'cancelled' WHERE id = $1", [sub.id]);

  console.log(`\nTest data: plan "${planName}" (id ${planId}), subscription ${sub.id} (active), user ${other.email}`);
  await pool.end();
})().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
