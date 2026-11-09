const config = require('./config');
const logger = require('./logger');
const { pool } = require('./db');
const { createApp } = require('./app');
const { startScheduler } = require('./jobs/scheduler');

let scheduler = null;

const app = createApp();
const server = app.listen(config.PORT, (err) => {
  // Express 5 passes listen errors (e.g. EADDRINUSE: port already taken) to this callback.
  if (err) {
    logger.error({ err }, 'failed to start server');
    process.exit(1);
  }
  logger.info(`listening on port ${config.PORT}`);
  if (config.JOBS_ENABLED) scheduler = startScheduler();
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // No new job ticks; a tick already running holds a pool client, so pool.end() below
  // waits for it to finish.
  scheduler?.stop();

  // Stop accepting connections; the callback runs once in-flight requests finish.
  server.close(async () => {
    try {
      await pool.end();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'error while closing database pool');
      process.exit(1);
    }
  });

  // Safety net: force-exit if something hangs. unref() lets the process exit earlier
  // without waiting for this timer.
  setTimeout(() => {
    logger.error('forced exit after 10s');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
