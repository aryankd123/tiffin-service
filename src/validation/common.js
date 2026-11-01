const { z } = require('zod');

// Path ids: BIGINT ids travel as strings. 1-18 digits always fits in BIGINT, so a
// huge or non-numeric id becomes a 400 here instead of a Postgres "out of range" 500.
const idParam = z.string().regex(/^[1-9]\d{0,17}$/, 'must be a positive integer id');

// India-only service area. Mirrored by CHECK constraints in migration 005.
const INDIA_BOX = { minLat: 6, maxLat: 38, minLng: 68, maxLng: 98 };

const location = z.object({
  lat: z.number().min(INDIA_BOX.minLat, 'latitude must be inside India (6 to 38)')
    .max(INDIA_BOX.maxLat, 'latitude must be inside India (6 to 38)'),
  lng: z.number().min(INDIA_BOX.minLng, 'longitude must be inside India (68 to 98)')
    .max(INDIA_BOX.maxLng, 'longitude must be inside India (68 to 98)'),
});

// Indian mobile numbers, stored in E.164 form: +91 followed by 10 digits starting 6-9.
// Accepts common ways people type them: "98765 43210", "+91-98765-43210", "098765 43210".
function normalisePhone(raw) {
  let digits = raw.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return `+91${digits}`;
}
const indianMobile = z
  .string()
  .max(20)
  .transform(normalisePhone)
  .pipe(z.string().regex(/^\+91[6-9]\d{9}$/, 'must be an Indian mobile number'));

// Indian PIN code: 6 digits, first digit 1-9.
const pinCode = z.string().trim().regex(/^[1-9]\d{5}$/, 'must be a 6-digit Indian PIN code');

// Optional text that the client may clear by sending null or "".
const optionalText = (max) =>
  z.union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v));

// A calendar date 'YYYY-MM-DD' that really exists (rejects 2026-02-30).
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD')
  .refine((d) => {
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
  }, 'must be a real calendar date');

// Delivery weekdays by name; stored as ISO numbers 1 (Mon) … 7 (Sun).
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const weekdays = z
  .array(z.enum(WEEKDAYS))
  .min(1)
  .max(7)
  .refine((days) => new Set(days).size === days.length, 'each weekday may appear only once')
  .transform((days) => days.map((d) => WEEKDAYS.indexOf(d) + 1).sort((a, b) => a - b));

// What Razorpay's checkout hands back to the browser after a successful payment.
const paymentVerify = z.object({
  gatewayPaymentId: z.string().min(1).max(100),
  signature: z.string().regex(/^[0-9a-f]{64}$/, 'must be a 64-character hex signature'),
});

module.exports = {
  idParam, location, indianMobile, pinCode, optionalText, isoDate, weekdays, WEEKDAYS, INDIA_BOX,
  paymentVerify,
};
