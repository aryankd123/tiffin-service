// Runs once before the API tests: brings the test database up to the latest migration.
// env.js sets DATABASE_URL to the test database and refuses any database not named *_test.
module.exports = async () => {
  require('./env');
  const { migrate } = require('../../scripts/migrate');
  await migrate(process.env.DATABASE_URL, () => {});
};
