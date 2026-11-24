const router = require('express').Router();
const c = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler: h } = require('../utils/http');

router.post('/login', h(c.login));
router.get('/me', requireAuth, h(c.me));
router.post('/change-password', requireAuth, h(c.changePassword));

module.exports = router;
