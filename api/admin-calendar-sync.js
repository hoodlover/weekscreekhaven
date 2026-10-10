import { readCalendarSync, refreshCalendarSync } from '../_lib/calendar-sync.js';
import { createCalendarFeedToken, json, requireAdmin } from '../_lib/security.js';

export const config = { maxDuration:60 };
export default async function handler(request, response) {
  const cron = process.env.CRON_SECRET && request.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  if (!cron && !requireAdmin(request)) return json(response,401,{error:'Please sign in as the site owner.'});
  if (!['GET','POST'].includes(request.method)) return json(response,405,{error:'Use GET or POST.'});
  try {
    let saved = await readCalendarSync();
    if (request.method === 'POST' || (cron && saved.feedUrl)) saved = await refreshCalendarSync(request.body?.feedUrl);
    const exportUrl = `https://www.weekscreekhaven.com/api/channel-calendar-feed?token=${encodeURIComponent(createCalendarFeedToken())}`;
    return json(response,200,{ connected:Boolean(saved.feedUrl), syncedAt:saved.syncedAt || null, count:saved.entries?.length || 0, exportUrl },{'Cache-Control':'private, no-store'});
  } catch { return json(response,503,{error:'Calendar sync could not refresh. Existing blocked dates have been kept. Check the Airbnb .ics link and try again.'}); }
}
