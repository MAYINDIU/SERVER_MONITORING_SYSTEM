const router = require('express').Router();
const c = require('../controllers/agentController');
const { requireAgent } = require('../middleware/auth');
const { asyncHandler: h } = require('../utils/http');

router.post('/register', h(c.register));
router.post('/metrics', requireAgent, h(c.metrics));
router.post('/security', requireAgent, h(c.security));

module.exports = router;
