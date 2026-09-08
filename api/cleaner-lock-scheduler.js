import { syncCleanerLocks } from '../_lib/cleaner-locks.js';
import { json, requireAdmin } from '../_lib/security.js';

export const config = { maxDuration: 60 };
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  const cron = process.env.CRON_SECRET && request.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const owner = request.method === 'POST' && requireAdmin(request);
  if (!cron && !owner) return json(response, 401, { error: 'Owner or scheduled authorization required.' });
  if (!['GET', 'POST'].includes(request.method)) return json(response, 405, { error: 'Use GET or POST.' });
  try { const result = await syncCleanerLocks(); return json(response, result.status === 'needs-attention' ? 503 : 200, { status: result.status, window: result.window || null }); }
  catch { return json(response, 503, { error: 'Cleaner lock sync needs attention. Check the saved PIN and schedule.' }); }
}
