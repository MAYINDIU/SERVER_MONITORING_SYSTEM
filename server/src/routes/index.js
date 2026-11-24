const router = require('express').Router();

router.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
router.use('/auth', require('./authRoutes'));
router.use('/agent', require('./agentRoutes'));
router.use('/dashboard', require('./dashboardRoutes'));
router.use('/servers', require('./serverRoutes'));
router.use('/alerts', require('./alertRoutes'));
router.use('/reports', require('./reportRoutes'));
router.use('/logins', require('./loginRoutes'));
router.use('/', require('./settingsRoutes'));

module.exports = router;
