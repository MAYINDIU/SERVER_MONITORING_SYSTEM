const router = require('express').Router();
const c = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler: h } = require('../utils/http');

router.use(requireAuth);
router.get('/overview', h(c.overview));
router.get('/system', h(c.system));

module.exports = router;
