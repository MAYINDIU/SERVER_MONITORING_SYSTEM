const router = require('express').Router();
const LoginModel = require('../models/loginModel');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler: h } = require('../utils/http');

router.use(requireAuth);

// GET /api/logins?server_id=&kind=logon|failed|connection&method=rdp|remote|...&ip=&q=&from=&to=&page=&limit=
router.get(
  '/',
  h(async (req, res) => {
    const q = req.query;
    res.json(
      await LoginModel.list({
        serverId: q.server_id, kind: q.kind, method: q.method, ip: q.ip, q: q.q,
        from: q.from, to: q.to, page: q.page, limit: q.limit,
      })
    );
  })
);

router.get('/summary', h(async (req, res) => res.json(await LoginModel.summary(req.query.server_id))));

module.exports = router;
