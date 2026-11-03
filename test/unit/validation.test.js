// Input rules shared by the routes and the PATCH builder.
const v = require('../../src/validation/common');
const { buildSet } = require('../../src/sql');

const ok = (schema, value) => schema.safeParse(value).success;

describe('idParam', () => {
  test.each(['1', '42', '123456789012345678'])('accepts %s', (id) => expect(ok(v.idParam, id)).toBe(true));
  test.each(['0', '01', '-1', '1.5', 'abc', '1234567890123456789', ''])('rejects "%s"', (id) => {
    expect(ok(v.idParam, id)).toBe(false);
  });
});

describe('isoDate', () => {
  test('accepts real dates, including 29 Feb in a leap year', () => {
    expect(ok(v.isoDate, '2026-11-03')).toBe(true);
    expect(ok(v.isoDate, '2028-02-29')).toBe(true);
  });
  test('rejects impossible or badly formatted dates (U4c)', () => {
    for (const d of ['2026-02-30', '2027-02-29', '2026-13-01', '3-11-2026', '2026-1-5']) {
      expect(ok(v.isoDate, d)).toBe(false);
    }
  });
});

describe('weekdays', () => {
  test('names become sorted ISO numbers', () => {
    expect(v.weekdays.parse(['fri', 'mon', 'wed'])).toEqual([1, 3, 5]);
  });
  test('rejects empty, repeated and unknown days (U5a-c)', () => {
    expect(ok(v.weekdays, [])).toBe(false);
    expect(ok(v.weekdays, ['mon', 'mon'])).toBe(false);
    expect(ok(v.weekdays, ['funday'])).toBe(false);
  });
});

describe('indianMobile', () => {
  test.each(['9876543210', '98765 43210', '+91-98765-43210', '098765 43210', '919876543210'])(
    '"%s" becomes +919876543210', (raw) => {
      expect(v.indianMobile.parse(raw)).toBe('+919876543210');
    },
  );
  test.each(['12345 67890', '98765', '+1 202 555 0100'])('rejects "%s"', (raw) => {
    expect(ok(v.indianMobile, raw)).toBe(false);
  });
});

describe('pinCode and location', () => {
  test('PIN codes are 6 digits not starting with 0', () => {
    expect(ok(v.pinCode, '560001')).toBe(true);
    expect(ok(v.pinCode, '060001')).toBe(false);
    expect(ok(v.pinCode, '56001')).toBe(false);
  });
  test('a pin must be inside the India box', () => {
    expect(ok(v.location, { lat: 12.97, lng: 77.59 })).toBe(true);   // Bengaluru
    expect(ok(v.location, { lat: 51.5, lng: -0.12 })).toBe(false);   // London
    expect(ok(v.location, { lat: 77.59, lng: 12.97 })).toBe(false);  // lat and lng swapped
  });
});

describe('paymentVerify', () => {
  const signature = 'a'.repeat(64);
  test('needs a payment id and a 64-character lowercase hex signature', () => {
    expect(ok(v.paymentVerify, { gatewayPaymentId: 'pay_1', signature })).toBe(true);
    expect(ok(v.paymentVerify, { gatewayPaymentId: 'pay_1', signature: 'A'.repeat(64) })).toBe(false);
    expect(ok(v.paymentVerify, { gatewayPaymentId: 'pay_1', signature: 'a'.repeat(63) })).toBe(false);
    expect(ok(v.paymentVerify, { gatewayPaymentId: '', signature })).toBe(false);
  });
});

describe('buildSet', () => {
  const whitelist = { name: 'name', pricePaise: 'price_paise', isActive: 'is_active' };

  test('only whitelisted fields, values as numbered parameters after the fixed ones', () => {
    const values = ['7'];
    const set = buildSet({ pricePaise: 5000, name: 'Thali', role: 'admin' }, whitelist, values);
    expect(set).toBe('name = $2, price_paise = $3');
    expect(values).toEqual(['7', 'Thali', 5000]);
  });

  test('a field sent as null is set to NULL; a missing one is left alone', () => {
    const values = [];
    expect(buildSet({ name: null }, whitelist, values)).toBe('name = $1');
    expect(values).toEqual([null]);
    expect(buildSet({}, whitelist, [])).toBe('');
  });
});
