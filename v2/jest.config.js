// Two groups of tests:
// - unit: pure functions, no database or network (fast; runs anywhere)
// - api:  HTTP requests through the whole app against the tiffin_test database. Each file
//         empties the database and loads fixed fixtures, so files must run one at a time
//         (npm test passes --runInBand).
// Both load test/setup/env.js first, which points the app at the test database only.
const shared = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup/env.js'],
};

module.exports = {
  projects: [
    { ...shared, displayName: 'unit', testMatch: ['<rootDir>/test/unit/**/*.test.js'] },
    {
      ...shared,
      displayName: 'api',
      testMatch: ['<rootDir>/test/api/**/*.test.js'],
      globalSetup: '<rootDir>/test/setup/global-setup.js',
      setupFilesAfterEnv: ['<rootDir>/test/setup/api-after-env.js'],
    },
  ],
};
