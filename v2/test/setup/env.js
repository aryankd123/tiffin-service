// Runs before every test file, before any app module loads config.
// Points the app at the test database and refuses anything else, so a test run can never wipe
// development data. The test database is the development URL with the database name replaced by
// "tiffin_test", unless TEST_DATABASE_URL is given (CI sets it).
require('dotenv').config({ quiet: true });

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (needed to find the test database)');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/tiffin_test';
  return url.toString();
}

const url = testDatabaseUrl();
const dbName = decodeURIComponent(new URL(url).pathname.slice(1));
if (!dbName.endsWith('_test')) {
  // Only the name is printed: the URL contains a password.
  throw new Error(`Refusing to run tests against database "${dbName}": its name must end with _test`);
}

process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';          // silences the logger
process.env.JOBS_ENABLED = 'false';     // tests call jobs directly
process.env.PAYMENT_PROVIDER = 'fake';  // offline gateway
process.env.BCRYPT_COST = '4';          // fast hashes; cost 12 is measured separately
