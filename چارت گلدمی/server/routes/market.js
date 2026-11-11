import { Router } from 'express';
import prisma from '../config/db.js';
import { loadMarketHistory } from '../services/marketHistory.js';

export function createMarketRoutes({ marketEngine }) {
  const router = Router();

  router.get('/market-data', (req, res) => {
    const snapshot = marketEngine.getSnapshot();
    res.json(snapshot);
  });

  /**
   * تاریخچه بر اساس تایم‌فریم. وب‌سوکت فقط دادهٔ زنده و پنجرهٔ اخیر را نگه
   * می‌دارد؛ بازه‌های بلند از این مسیر خوانده می‌شوند.
   */
  router.get('/market/candles', async (req, res, next) => {
    try {
      const result = await loadMarketHistory(prisma, req.query);
      if (!result.ok) return res.status(400).json({ error: result.error });
      res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
