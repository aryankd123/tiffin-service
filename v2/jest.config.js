// Two groups of tests:
// - unit: pure functions, no database or network (fast; runs anywhere)
// - api:  HTTP requests through the whole app against the tiffin_test database
// Both load test/setup/env.js first, which points the app at the test database only.
const shared = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup/env.js'],
};

module.exports = {
  projects: [
    { ...shared, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.test.js'] },
  ],
};
