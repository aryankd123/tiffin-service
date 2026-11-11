// Plans and subscribing: plan rules, start dates, weekdays, snapshots, who may see and cancel,
// and the database's own checks (V1-V7, U1-U12).
const { pool } = require('../../src/db');
const clock = require('../../src/clock');
const { call, login, registerUser, errorCode, pay, subscribePaid } = require('../helpers/api');
const { resetWorld } = require('../helpers/world');

let world; let customer; let vendor; let admin; let k; let planId; let sub;
const now = clock.istNow();
const firstOpen = clock.firstOpenDate(now);

beforeAll(async () => {
  world = await resetWorld();
  customer = await login(world.users.customer.email);
  vendor = await login(world.users.vendor.email);
  admin = await login(world.users.admin.email);
  k = world.restaurants.koramangala;
});

const plans = (rid) => `/restaurants/${rid}/plans`;
const subscribe = (token, body) => call('POST', '/subscriptions', { token, body: { addressId: world.addresses.home, ...body } });

describe('plans (V1-V7)', () => {
  const planBody = { name: '5 Lunches', mealSlot: 'lunch', mealsCount: 5, pricePaise: 60000 };

  test('V1: public plans with a price per meal', async () => {
    const res = await call('GET', plans(k.id));
    expect(res.status).toBe(200);
    expect(res.body.plans.map((p) => [p.name, p.pricePaise, p.pricePerMealPaise]).sort())
      .toEqual([['20 Dinners', 300000, 15000], ['20 Lunches', 280000, 14000]]);
  });

  test('V2-V5: a kitchen creates plans within the rules; customers cannot', async () => {
    const created = await call('POST', plans(k.id), { token: vendor.token, body: planBody });
    expect(created.status).toBe(201);
    expect(created.body.plan.pricePerMealPaise).toBe(12000);
    planId = created.body.plan.id;
    const dup = await call('POST', plans(k.id), { token: vendor.token, body: planBody });
    expect([dup.status, errorCode(dup)]).toEqual([409, 'PLAN_EXISTS']);
    expect((await call('POST', plans(k.id), { token: vendor.token, body: { ...planBody, name: 'x61', mealsCount: 61 } })).status).toBe(400);
    expect((await call('POST', plans(k.id), { token: vendor.token, body: { ...planBody, name: 'xb', mealSlot: 'breakfast' } })).status).toBe(400);
    expect((await call('POST', plans(k.id), { token: customer.token, body: { ...planBody, name: 'xc' } })).status).toBe(403);
  });

  test("V6-V7: another kitchen's plan can't be edited via this URL; slot and size are fixed", async () => {
    const cpPlan = await call('POST', plans(world.restaurants.connaught.id), { token: vendor.token, body: { ...planBody, name: 'Delhi 5' } });
    const viaWrongUrl = await call('PATCH', `${plans(k.id)}/${cpPlan.body.plan.id}`, { token: vendor.token, body: { pricePaise: 100 } });
    expect([viaWrongUrl.status, errorCode(viaWrongUrl)]).toEqual([404, 'PLAN_NOT_FOUND']);
    expect((await call('PATCH', `${plans(k.id)}/${planId}`, { token: vendor.token, body: { mealsCount: 10 } })).status).toBe(400);
  });
});

describe('subscribing (U1-U5)', () => {
  test('U1: subscribe, pay, and see the next delivery dates on the picked weekdays', async () => {
    const res = await subscribe(customer.token, { planId, weekdays: ['fri', 'mon', 'wed'] });
    expect(res.status).toBe(201);
    expect(res.body.subscription).toMatchObject({ status: 'awaiting_payment', startDate: firstOpen, weekdays: ['mon', 'wed', 'fri'] });
    const paid = await pay(customer.token, `/subscriptions/${res.body.subscription.id}`, res.body.payment);
    sub = paid.body.subscription;
    const expected = [];
    for (let d = firstOpen; expected.length < 5; d = clock.addDays(d, 1)) if ([1, 3, 5].includes(clock.isoWeekday(d))) expected.push(d);
    expect(sub.status).toBe('active');
    expect(sub.nextDeliveryDates).toEqual(expected);
    expect(sub.projectedLastDate).toBe(expected[4]);
    expect(sub.progress).toEqual({ delivered: 0, scheduled: 0, missed: 0, remaining: 5 });
    expect(sub.plan).toMatchObject({ name: '5 Lunches', mealSlot: 'lunch', mealsTotal: 5, pricePaise: 60000 });
  });

  test('U2-U3: no second subscription to the same plan and address; the kitchen must reach it', async () => {
    const dup = await subscribe(customer.token, { planId, weekdays: ['tue'] });
    expect([dup.status, errorCode(dup)]).toEqual([409, 'SUBSCRIPTION_EXISTS']);
    const far = await subscribe(customer.token, { planId, addressId: world.addresses.parents, weekdays: ['mon'] });
    expect([far.status, errorCode(far)]).toEqual([422, 'NOT_SERVICEABLE']);
  });

  test('U4: the start date must be open and within 30 days', async () => {
    const today = await subscribe(customer.token, { planId, addressId: world.addresses.parents, weekdays: ['mon'], startDate: now.date });
    expect([today.status, errorCode(today)]).toEqual([422, 'START_DATE_LOCKED']);
    expect(today.body.error.details.firstOpenDate).toBe(firstOpen);
    const tooFar = await subscribe(customer.token, { planId: k.plans['20 Lunches'], weekdays: ['mon'], startDate: clock.addDays(now.date, 40) });
    expect([tooFar.status, errorCode(tooFar)]).toEqual([422, 'START_DATE_TOO_FAR']);
    expect((await subscribe(customer.token, { planId, weekdays: ['mon'], startDate: '2026-02-30' })).status).toBe(400);
  });

  test.each([[[]], [['mon', 'mon']], [['funday']]])('U5: weekdays %j are rejected', async (weekdays) => {
    expect((await subscribe(customer.token, { planId, weekdays })).status).toBe(400);
  });
});

describe('plan changes, snapshots and visibility (U6-U8)', () => {
  test('U6: a plan switched off takes no new subscribers but keeps existing ones', async () => {
    const other = await registerUser('subs.other');
    const home = await call('POST', '/addresses', { token: other.token, body: { label: 'Home', contactName: 'Other', contactPhone: '9876543210', line1: 'MG Road', postalCode: '560001', cityId: world.cities.bengaluru, location: { lat: 12.9716, lng: 77.5946 } } });
    await call('PATCH', `${plans(k.id)}/${planId}`, { token: vendor.token, body: { isActive: false } });
    const res = await subscribe(other.token, { planId, addressId: home.body.address.id, weekdays: ['mon'] });
    await call('PATCH', `${plans(k.id)}/${planId}`, { token: vendor.token, body: { isActive: true } });
    expect([res.status, errorCode(res)]).toEqual([404, 'PLAN_NOT_FOUND']);
    expect((await call('GET', `/subscriptions/${sub.id}`, { token: customer.token })).body.subscription.status).toBe('active');
  });

  test('U7: a price rise applies to new subscribers only', async () => {
    await call('PATCH', `${plans(k.id)}/${planId}`, { token: vendor.token, body: { pricePaise: 99900 } });
    const res = await call('GET', `/subscriptions/${sub.id}`, { token: customer.token });
    await call('PATCH', `${plans(k.id)}/${planId}`, { token: vendor.token, body: { pricePaise: 60000 } });
    expect(res.body.subscription.plan.pricePaise).toBe(60000);
  });

  test('U8: the customer, the kitchen and an admin can see it; nobody else', async () => {
    const stranger = await registerUser('subs.stranger');
    expect((await call('GET', '/subscriptions', { token: customer.token })).body.subscriptions[0].id).toBe(sub.id);
    expect((await call('GET', `/subscriptions/${sub.id}`, { token: stranger.token })).status).toBe(404);
    expect((await call('GET', `/subscriptions/${sub.id}`, { token: vendor.token })).status).toBe(200);
    expect((await call('GET', `/subscriptions/${sub.id}`, { token: admin.token })).status).toBe(200);
  });
});

describe('several subscriptions and cancelling (U9-U11)', () => {
  const dinners = () => ({ planId: k.plans['20 Dinners'], addressId: world.addresses.home });

  test('U9-U10: a second plan at the same address; cancelling refunds unused meals; re-subscribing works', async () => {
    const second = await subscribePaid(customer.token, { ...dinners(), weekdays: ['sat', 'sun'] });
    const cancelled = await call('POST', `/subscriptions/${second.id}/cancel`, { token: customer.token, body: { reason: 'Moving out' } });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.subscription.cancelled).toMatchObject({ by: 'customer', reason: 'Moving out' });
    expect(cancelled.body.subscription.payment.refund).toMatchObject({ status: 'requested', amountPaise: 300000, reason: 'Subscription cancelled by customer: 20 of 20 meals unused' });
    const again = await call('POST', `/subscriptions/${second.id}/cancel`, { token: customer.token });
    expect([again.status, errorCode(again)]).toEqual([409, 'CANCEL_NOT_ALLOWED']);
    const resubscribed = await subscribePaid(customer.token, { ...dinners(), weekdays: ['sat'] });
    expect(resubscribed.status).toBe('active');

    // U11: the kitchen may cancel a customer's subscription too
    const byKitchen = await call('POST', `/subscriptions/${resubscribed.id}/cancel`, { token: vendor.token });
    expect(byKitchen.status).toBe(200);
    expect(byKitchen.body.subscription.cancelled.by).toBe('restaurant');
  });
});

describe('database backstops (U12)', () => {
  test('a second active subscription, weekday 8, or cancelled without a time are all refused', async () => {
    await expect(pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, address_id, status, plan_name_snapshot, price_paise_snapshot, meal_slot, meals_total, delivery_weekdays, start_date)
       VALUES ($1, $2, $3, 'awaiting_payment', 'x', 100, 'lunch', 5, '{1}', $4)`,
      [customer.id, planId, world.addresses.home, firstOpen],
    )).rejects.toMatchObject({ constraint: 'subscriptions_one_active_per_plan_address' });
    await expect(pool.query("UPDATE subscriptions SET delivery_weekdays = '{1,8}' WHERE id = $1", [sub.id]))
      .rejects.toMatchObject({ constraint: 'subscriptions_weekdays_check' });
    await expect(pool.query("UPDATE subscriptions SET status = 'cancelled' WHERE id = $1", [sub.id]))
      .rejects.toMatchObject({ constraint: 'subscriptions_cancel_consistent' });
  });
});
