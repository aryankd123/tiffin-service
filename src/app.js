const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const logger = require('./logger');
const { pool } = require('./db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth');
const meRoutes = require('./routes/me');
const cityRoutes = require('./routes/cities');
const addressRoutes = require('./routes/addresses');
const restaurantRoutes = require('./routes/restaurants');
const userRoutes = require('./routes/users');
const orderRoutes = require('./routes/orders');
const subscriptionRoutes = require('./routes/subscriptions');
const deliveryRoutes = require('./routes/deliveries');

// Builds the app without listening, so tests can import it and drive it with supertest.
function createApp() {
  const app = express();

  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '100kb' }));

  // Express 5 forwards a rejected promise from an async handler to errorHandler.
  app.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/me', meRoutes);
  app.use('/api/v1/cities', cityRoutes);
  app.use('/api/v1/addresses', addressRoutes);
  app.use('/api/v1/restaurants', restaurantRoutes);
  app.use('/api/v1/users', userRoutes);
  app.use('/api/v1/orders', orderRoutes);
  app.use('/api/v1/subscriptions', subscriptionRoutes);
  app.use('/api/v1/deliveries', deliveryRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
