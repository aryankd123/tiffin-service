const express = require('express');
const AuthController = require('../controllers/authController');
const router = express.Router();

console.log('Auth routes file loaded'); // Debug log

// Register route
router.post('/register', (req, res) => {
  console.log('=== /register ROUTE HIT ===');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);
  console.log('Request body:', req.body);
  AuthController.register(req, res);
});

// Login route
router.post('/login', (req, res) => {
  console.log('=== /login ROUTE HIT ===');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);
  console.log('Request body:', req.body);
  AuthController.login(req, res);
});

module.exports = router;
