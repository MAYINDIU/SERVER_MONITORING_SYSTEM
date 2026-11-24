const router = require('express').Router();
const c = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler: h } = require('../utils/http');

// ?range=hour|today|24h|7d|30d|12m   or   ?from=ISO&to=ISO
router.use(requireAuth);
router.get('/fleet', h(c.fleet));
router.get('/fleet/csv', h(c.fleetCsv));
router.get('/alerts', h(c.alerts));
router.get('/server/:id', h(c.server));
router.get('/server/:id/csv', h(c.serverCsv));

module.exports = router;
