const router = require('express').Router();
const c = require('../controllers/alertController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler: h } = require('../utils/http');

router.use(requireAuth);
router.get('/', h(c.list));
router.get('/summary', h(c.summary));
router.get('/:id', h(c.get));
router.post('/:id/ack', requireRole('admin', 'operator'), h(c.acknowledge));
router.post('/:id/resolve', requireRole('admin', 'operator'), h(c.resolve));
router.post('/:id/notes', requireRole('admin', 'operator'), h(c.addNote));

module.exports = router;
