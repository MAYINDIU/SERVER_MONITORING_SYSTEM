const router = require('express').Router();
const c = require('../controllers/settingsController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler: h } = require('../utils/http');

const admin = requireRole('admin');
router.use(requireAuth);

// settings
router.get('/settings', h(c.get));
router.put('/settings', admin, h(c.update));
router.post('/settings/sms/test', admin, h(c.testSms));

// alert rules
router.get('/rules', h(c.listRules));
router.post('/rules', admin, h(c.createRule));
router.put('/rules/:id', admin, h(c.updateRule));
router.delete('/rules/:id', admin, h(c.deleteRule));

// users
router.get('/users', admin, h(c.listUsers));
router.post('/users', admin, h(c.createUser));
router.put('/users/:id', admin, h(c.updateUser));
router.delete('/users/:id', admin, h(c.deleteUser));

// logs
router.get('/notifications', h(c.notifications));
router.get('/audit', admin, h(c.audit));

module.exports = router;
