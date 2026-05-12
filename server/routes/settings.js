import { Router } from 'express';
import db from '../db/init.js';
import { runKeepAlive, startKeepAliveScheduler } from '../services/keep-alive.js';

const router = Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

router.put('/', (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const transaction = db.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run(key, String(value));
    }
  });
  transaction(Object.entries(req.body));

  if ('keepalive_interval_days' in req.body) {
    startKeepAliveScheduler();
  }

  res.json({ success: true });
});

router.post('/keepalive', async (req, res, next) => {
  try {
    const results = await runKeepAlive();
    res.json({ success: true, results });
  } catch (err) {
    next(err);
  }
});

export default router;
