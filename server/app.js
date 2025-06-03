const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();

// Use body-parser explicitly
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
const PORT = process.env.PORT || 5000;
const orderRoutes = require('./routes/orderRoutes');
app.use('/api/orders', orderRoutes);

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`=== ${new Date().toISOString()} ===`);
  console.log(`${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('========================');
  next();
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Basic routes
app.get('/', (req, res) => {
  console.log('GET / route hit');
  res.json({ message: 'Tiffin Service API is running!' });
});

// Import and use auth routes
try {
  const authRoutes = require('./routes/authRoutes');
  app.use('/api/auth', authRoutes);
  console.log('Auth routes loaded successfully');
} catch (error) {
  console.error('Error loading auth routes:', error.message);
}

try {
  const menuRoutes = require('./routes/menuRoutes');
  app.use('/api/menu', menuRoutes);
  console.log('Menu routes loaded successfully');
} catch (error) {
  console.error('Error loading menu routes:', error.message);
}


// Add subscription routes
try {
  const subscriptionRoutes = require('./routes/subscriptionRoutes');
  app.use('/api/subscriptions', subscriptionRoutes);
  console.log('Subscription routes loaded successfully');
} catch (error) {
  console.error('Error loading subscription routes:', error.message);
}



// Import auth middleware and add protected route
const authenticateToken = require('./middleware/auth');

app.get('/api/protected', authenticateToken, (req, res) => {
  console.log('Protected route accessed by user:', req.user);
  res.json({
    message: 'Access granted to protected route!',
    user: req.user
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`=== SERVER STARTED ===`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Test in browser: http://localhost:${PORT}`);
  console.log(`======================`);
});
