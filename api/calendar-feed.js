import { getBookingCalendar } from '../_lib/booking-store.js';
import { buildOwnerCalendar } from '../_lib/ical.js';
import { verifyCalendarFeedToken } from '../_lib/security.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).send('Method not allowed.');
  }
  const token = new URL(request.url, 'https://www.weekscreekhaven.com').searchParams.get('token');
  if (!verifyCalendarFeedToken(token)) return response.status(404).send('Calendar not found.');
  try {
    const calendar = await getBookingCalendar();
    response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    response.setHeader('Content-Disposition', 'inline; filename="weeks-creek-haven.ics"');
    response.setHeader('Cache-Control', 'private, max-age=0, s-maxage=300, stale-while-revalidate=300');
    return response.status(200).send(buildOwnerCalendar(calendar));
  } catch (error) {
    console.error('Calendar feed failed', error);
    return response.status(503).send('Calendar temporarily unavailable.');
  }
}
