const jwt = require('jsonwebtoken');
const User = require('../models/User');

console.log('AuthController loaded successfully'); // Debug log

class AuthController {
  // User registration
  static async register(req, res) {
    console.log('=== REGISTER CONTROLLER CALLED ===');
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    
    try {
      const { name, email, password } = req.body;

      console.log('Extracted data:', { name, email, password: password ? '***' : 'undefined' });

      // Check if user already exists
      console.log('Checking if user exists...');
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        console.log('User already exists');
        return res.status(400).json({ message: 'User already exists' });
      }

      // Create new user
      console.log('Creating new user...');
      const user = await User.create({ name, email, password });
      console.log('User created:', user);

      // Generate JWT token
      console.log('Generating JWT token...');
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log('Sending success response...');
      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ 
        message: 'Internal server error',
        error: error.message 
      });
    }
  }

  // User login
  static async login(req, res) {
    console.log('=== LOGIN CONTROLLER CALLED ===');
    console.log('Request body:', req.body);
    
    try {
      const { email, password } = req.body;

      console.log('Looking for user with email:', email);

      // Find user by email
      const user = await User.findByEmail(email);
      if (!user) {
        console.log('User not found');
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      console.log('User found, verifying password...');

      // Verify password
      const isValidPassword = await User.verifyPassword(password, user.password);
      if (!isValidPassword) {
        console.log('Invalid password');
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      console.log('Password valid, generating token...');

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      console.log('Sending login success response...');
      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ 
        message: 'Internal server error',
        error: error.message 
      });
    }
  }
}

module.exports = AuthController;
