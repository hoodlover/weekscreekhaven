import { getInvites } from '../_lib/invite-store.js';
import { getBookingCalendar } from '../_lib/booking-store.js';
import { json, requireInvite } from '../_lib/security.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  const session = requireInvite(request);
  if (!session) return json(response, 401, { error: 'Please use your invite to sign in.' });
  try {
    const [invites, calendar] = await Promise.all([getInvites(), getBookingCalendar()]);
    const invite = invites.find((item) => item.id === session.inviteId);
    const expired = invite?.expiresAt && new Date(invite.expiresAt).getTime() < Date.now();
    if (!invite || invite.revokedAt || expired) return json(response, 403, { error: 'This invite is no longer active.' });
    const booking = invite.bookingId ? calendar.bookings.find((item) => item.id === invite.bookingId) : null;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const todayValues = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
    return json(response, 200, {
      visitorName: session.visitorName,
      inviteLabel: invite.label,
      welcomeMessage: invite.welcomeMessage || '',
      stayOptions: (invite.stayOptions || []).map((option, index) => {
        const selected = Boolean(booking && ['reserved', 'booked'].includes(booking.status) && booking.approvedChoice === index);
        return { ...option, expired: !selected && Boolean(option.expiresOn && option.expiresOn < today), selected };
      }),
      stayStatus: booking?.status || null,
      selectedStayChoice: booking && ['reserved', 'booked'].includes(booking.status) ? booking.approvedChoice : null,
      photos: (invite.photos || []).map((photo) => ({ id: photo.id })),
    }, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Your welcome page is temporarily unavailable.' });
  }
}
