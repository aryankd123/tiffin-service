const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access token required' });
  }

  try {
    // Try to verify as your own JWT first
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    // If JWT fails, try Google token validation
    try {
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      req.user = { 
        userId: payload.sub, 
        email: payload.email,
        name: payload.name 
      };
      next();
    } catch (googleErr) {
      console.error('Token validation failed:', googleErr);
      return res.status(403).json({ message: 'Invalid token' });
    }
  }
};

module.exports = authenticateToken;
