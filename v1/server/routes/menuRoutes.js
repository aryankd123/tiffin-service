const express = require('express');
const MenuController = require('../controllers/menuController');
const authenticateToken = require('../middleware/auth');
const router = express.Router();

console.log('Menu routes file loaded');

// Public routes (no authentication required)
router.get('/', MenuController.getAllItems);
router.get('/category/:category', MenuController.getItemsByCategory);
router.get('/:id', MenuController.getItem);

// Protected routes (authentication required)
router.post('/', authenticateToken, MenuController.createItem);

module.exports = router;
