import { createCalendarFeedToken, json, requireAdmin } from '../_lib/security.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  const feedUrl = `https://www.weekscreekhaven.com/api/calendar-feed?token=${encodeURIComponent(createCalendarFeedToken())}`;
  return json(response, 200, { feedUrl }, { 'Cache-Control': 'private, no-store' });
}
