const router = require('express').Router();
const c = require('../controllers/serverController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler: h } = require('../utils/http');

router.use(requireAuth);
router.get('/', h(c.list));
router.get('/groups', h(c.groups));
router.post('/', requireRole('admin', 'operator'), h(c.create));
router.post('/ping', requireRole('admin', 'operator'), h(c.ping));
router.get('/:id', h(c.get));
router.get('/:id/latest', h(c.latest));
router.put('/:id', requireRole('admin', 'operator'), h(c.update));
router.delete('/:id', requireRole('admin'), h(c.remove));

module.exports = router;
