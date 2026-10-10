import { getBookingCalendar, unavailableRanges } from '../_lib/booking-store.js';
import { buildOwnerCalendar } from '../_lib/ical.js';
import { verifyCalendarFeedToken } from '../_lib/security.js';

export default async function handler(request,response) {
  const supplied = new URL(request.url,'https://www.weekscreekhaven.com').searchParams.get('token');
  if (request.method !== 'GET' || !verifyCalendarFeedToken(supplied)) return response.status(404).send('Calendar not found.');
  try {
    const calendar = await getBookingCalendar();
    // Only local unavailable nights: no names, private notes, requests, flexible holds, or imported dates.
    const blocks = unavailableRanges({...calendar, externalEntries:[]}).map((range,index) => ({ id:range.id || range.bookingId || `range-${index}`, arrival:range.arrival, departure:range.departure, label:'Unavailable', holdType:'firm', createdAt:'2026-01-01T00:00:00Z' }));
    response.setHeader('Content-Type','text/calendar; charset=utf-8');
    response.setHeader('Cache-Control','private, no-store');
    return response.status(200).send(buildOwnerCalendar({bookings:[],blocks}));
  } catch { return response.status(503).send('Calendar temporarily unavailable.'); }
}
