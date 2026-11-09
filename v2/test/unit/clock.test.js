// IST calendar rules. Pure functions: fixed inputs, no waiting for 9 PM.
const clock = require('../../src/clock');

const at = (date, hh, mm) => ({ date, minutes: hh * 60 + mm });

describe('isoWeekday', () => {
  test('Sunday is 7 and Monday is 1 (Q1)', () => {
    expect(clock.isoWeekday('2026-11-01')).toBe(7);
    expect(clock.isoWeekday('2026-11-02')).toBe(1);
  });
});

describe('addDays', () => {
  test.each([
    ['2026-02-28', 1, '2026-03-01'],
    ['2028-02-28', 1, '2028-02-29'], // leap year
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-01', -1, '2026-02-28'],
  ])('%s + %i day = %s', (date, n, expected) => {
    expect(clock.addDays(date, n)).toBe(expected);
  });
});

describe('the 9 PM cutoff', () => {
  test('until 20:59 tomorrow is still open (Q1)', () => {
    expect(clock.firstOpenDate(at('2026-11-01', 20, 59))).toBe('2026-11-02');
    expect(clock.isLocked('2026-11-02', at('2026-11-01', 20, 59))).toBe(false);
  });

  test('from 21:00 tomorrow is locked (Q1)', () => {
    expect(clock.firstOpenDate(at('2026-11-01', 21, 0))).toBe('2026-11-03');
    expect(clock.isLocked('2026-11-02', at('2026-11-01', 21, 0))).toBe(true);
  });

  test('today is always locked', () => {
    expect(clock.isLocked('2026-11-01', at('2026-11-01', 0, 0))).toBe(true);
  });
});

describe('istNow', () => {
  test('gives an IST date as YYYY-MM-DD and minutes since midnight', () => {
    const now = clock.istNow();
    expect(now.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(now.minutes).toBeGreaterThanOrEqual(0);
    expect(now.minutes).toBeLessThan(24 * 60);
  });
});
