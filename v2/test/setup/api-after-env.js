// Loaded into every API test file. Each file gets its own copy of the app modules, so each
// closes its own connection pool when it finishes.
const { pool } = require('../../src/db');

jest.setTimeout(30000);

afterAll(() => pool.end());
