const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware (put body parsing FIRST)

app.use(cors({
  origin: [
    'http://localhost:3000',                    // React development server
    'https://your-frontend-name.onrender.com'  // Production frontend (you'll update this later)
  ],
  credentials: true,  // Allow cookies/auth headers
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log all incoming requests (AFTER body parsing)
app.use((req, res, next) => {
  console.log(`=== ${new Date().toISOString()} ===`);
  console.log(`${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body); // Now this will show the actual body
  console.log('========================');
  next();
});

const PORT = process.env.PORT || 5000;

// Basic routes
app.get('/', (req, res) => {
  console.log('GET / route hit');
  res.json({ message: 'Tiffin Service API is running!' });
});

// Import and use routes
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

try {
  const orderRoutes = require('./routes/orderRoutes');
  app.use('/api/orders', orderRoutes);
  console.log('Order routes loaded successfully');
} catch (error) {
  console.error('Error loading order routes:', error.message);
}

try {
  const subscriptionRoutes = require('./routes/subscriptionRoutes');
  app.use('/api/subscriptions', subscriptionRoutes);
  console.log('Subscription routes loaded successfully');
} catch (error) {
  console.error('Error loading subscription routes:', error.message);
}

// Start server
app.listen(PORT, () => {
  console.log(`=== SERVER STARTED ===`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Test in browser: http://localhost:${PORT}`);
  console.log(`======================`);
});
