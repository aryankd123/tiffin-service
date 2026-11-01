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

module.exports = { idParam, location, indianMobile, pinCode, optionalText, INDIA_BOX };
