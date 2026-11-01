require('dotenv').config({ quiet: true });
const { z } = require('zod');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  // HS256 key: at least 32 characters so it can't be brute-forced from a captured token.
  JWT_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  // 12 is ~326 ms per hash on the dev laptop; tests can lower it to keep suites fast.
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  // OAuth client ID from Google Cloud Console. Optional: without it, Google login is disabled.
  // Not a secret (it's also embedded in the frontend); the client *secret* is never needed here.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  // Scheduled jobs (nightly subscription deliveries, auto-cancel) run inside the server unless
  // switched off, e.g. for a second instance or while debugging.
  JOBS_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print only the key and the problem, never the value: DATABASE_URL contains a password.
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

module.exports = Object.freeze(parsed.data);
