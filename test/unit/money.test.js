// Pro-rata refunds and the order fingerprint.
const { proRataRefundPaise } = require('../../src/services/subscriptionService');
const { requestFingerprint } = require('../../src/services/orderService');

describe('proRataRefundPaise', () => {
  test.each([
    ['nothing used (N1)', 60000, 5, 5, 60000],
    ['2 of 5 unused (N2)', 60000, 2, 5, 24000],
    ['2 of 3 unused, rounded down (N3)', 100000, 2, 3, 66666],
    ['all used or locked (N4)', 40000, 0, 2, 0],
  ])('%s', (_label, paid, unused, total, expected) => {
    expect(proRataRefundPaise(paid, unused, total)).toBe(expected);
  });

  test('never more than was paid, and grows with each unused meal', () => {
    for (const paid of [1, 99, 60000, 100000, 2_000_000_000]) {
      for (let total = 1; total <= 60; total++) {
        let previous = -1;
        for (let unused = 0; unused <= total; unused++) {
          const refund = proRataRefundPaise(paid, unused, total);
          expect(Number.isInteger(refund)).toBe(true);
          expect(refund).toBeLessThanOrEqual(paid);
          expect(refund).toBeGreaterThanOrEqual(previous);
          previous = refund;
        }
        expect(proRataRefundPaise(paid, total, total)).toBe(paid);
      }
    }
  });
});

describe('requestFingerprint', () => {
  const cart = {
    restaurantId: '5',
    addressId: '12',
    items: [{ menuItemId: '10', quantity: 2 }, { menuItemId: '9', quantity: 1 }],
  };

  test('is a SHA-256 hex digest', () => {
    expect(requestFingerprint(cart)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the same cart listed in another order gives the same fingerprint', () => {
    const reordered = { ...cart, items: [...cart.items].reverse() };
    expect(requestFingerprint(reordered)).toBe(requestFingerprint(cart));
  });

  test('any change to quantity, item, address or restaurant changes it', () => {
    const base = requestFingerprint(cart);
    expect(requestFingerprint({ ...cart, items: [{ menuItemId: '10', quantity: 3 }, cart.items[1]] })).not.toBe(base);
    expect(requestFingerprint({ ...cart, items: [cart.items[0]] })).not.toBe(base);
    expect(requestFingerprint({ ...cart, addressId: '13' })).not.toBe(base);
    expect(requestFingerprint({ ...cart, restaurantId: '6' })).not.toBe(base);
  });
});
