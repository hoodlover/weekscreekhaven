import { getInvites } from '../_lib/invite-store.js';
import { getBookingCalendar } from '../_lib/booking-store.js';
import { createAgreementToken, json, requireInvite } from '../_lib/security.js';
import { findInviteBooking } from '../_lib/booking-invite.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  const session = requireInvite(request);
  if (!session) return json(response, 401, { error: 'Please use your invite to sign in.' });
  try {
    const [invites, calendar] = await Promise.all([getInvites(), getBookingCalendar()]);
    const invite = invites.find((item) => item.id === session.inviteId);
    const expired = invite?.expiresAt && new Date(invite.expiresAt).getTime() < Date.now();
    if (!invite || invite.revokedAt || expired) return json(response, 403, { error: 'This invite is no longer active.' });
    const booking = findInviteBooking(invite, calendar.bookings);
    const chosenStay = booking?.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || null;
    const packetReady = booking && ['reserved', 'booked'].includes(booking.status);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const todayValues = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
    return json(response, 200, {
      visitorName: session.visitorName,
      inviteLabel: invite.label,
      welcomeMessage: invite.welcomeMessage || '',
      complimentary: invite.complimentary === true,
      stayOptions: (invite.stayOptions || []).map((option, index) => {
        const selected = Boolean(booking && ['reserved', 'booked'].includes(booking.status) && booking.approvedChoice === index);
        return { ...option, expired: !selected && Boolean(option.expiresOn && option.expiresOn < today), selected };
      }),
      stayStatus: booking?.status || null,
      selectedStayChoice: booking && ['reserved', 'booked'].includes(booking.status) ? booking.approvedChoice : null,
      bookingPacketUrl: packetReady ? `/booking-packet.html?token=${encodeURIComponent(createAgreementToken(booking.id, 365 * 86400))}` : '',
      bookingProfile: { guestName: booking?.name || invite.label, email: booking?.email || invite.recipientEmail || '', guests: booking?.guests || 1, arrival: chosenStay?.arrival || '', departure: chosenStay?.departure || '' },
      photos: (invite.photos || []).map((photo) => ({ id: photo.id })),
    }, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Your welcome page is temporarily unavailable.' });
  }
}
