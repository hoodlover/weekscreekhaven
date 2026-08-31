import { getBookingCalendar } from '../_lib/booking-store.js';
import { findBookingInvite } from '../_lib/booking-invite.js';
import { guestFirstName } from '../_lib/guest-name.js';
import { getInvites } from '../_lib/invite-store.js';
import { refreshSquareBooking } from '../_lib/payment-sync.js';
import { bookingAccessCode, json, verifyAgreementToken } from '../_lib/security.js';

function easternParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function doorCodeRelease(booking, arrival) {
  const now = easternParts();
  const today = `${now.year}-${now.month}-${now.day}`;
  const released = Boolean(
    booking.status === 'booked' && booking.doorCode && booking.doorCodeInstalledAt &&
    !booking.doorCodeRemovedAt && arrival &&
    (today > arrival || (today === arrival && Number(now.hour) >= 9))
  );
  return {
    doorCode: released ? String(booking.doorCode) : '',
    doorCodeAvailable: released,
    doorCodeReleaseText: 'Available at 9:00 AM Eastern on check-in day',
  };
}

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  try {
    const token = verifyAgreementToken(request.query?.token);
    if (!token) return json(response, 404, { error: 'This booking-packet link is invalid or has expired.' });
    const [calendar, invites] = await Promise.all([
      getBookingCalendar(),
      getInvites().catch(() => []),
    ]);
    let booking = calendar.bookings.find((item) => item.id === token.bookingId);
    if (!booking) return json(response, 404, { error: 'Booking not found.' });
    if (booking.squareInvoiceId && !(booking.status === 'booked' && booking.paymentFullyPaid && booking.bookedWelcomeSentAt)) {
      try { booking = await refreshSquareBooking(booking); } catch { /* Show the last confirmed status. */ }
    }
    const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0] || {};
    const complimentary = booking.paymentPlan === 'complimentary' || Number(booking.amountCents) === 0;
    const friendsAndFamily = Boolean(booking.friendsAndFamilyDiscount || dates.quote?.friendsAndFamilyDiscount);
    const linkedInvite = findBookingInvite(booking, invites);
    const discountId = booking.friendsAndFamilyDiscount?.id || dates.quote?.friendsAndFamilyDiscount?.id || '';
    const linkedDiscount = discountId ? (calendar.discounts || []).find((rule) => rule.id === discountId) : null;
    const doorAccess = doorCodeRelease(booking, dates.arrival || '');
    return json(response, 200, {
      guestName: guestFirstName(booking.name),
      guestFullName: booking.name || '',
      guestEmail: booking.email || '',
      guestPhone: booking.phone || linkedInvite?.recipientPhone || linkedDiscount?.target || '',
      reservationCode: bookingAccessCode(booking.id),
      arrival: dates.arrival || '',
      departure: dates.departure || '',
      guests: booking.guests || 1,
      totalCents: Number(booking.amountCents) || 0,
      stayAmountCents: Number(booking.stayAmountCents ?? booking.amountCents) || 0,
      securityDepositCents: Number(booking.securityDepositCents) || 0,
      status: booking.status || 'pending',
      checkInTime: '4:00 PM',
      checkoutTime: friendsAndFamily ? 'Flexible — no set time' : (booking.lateCheckout ? 'noon' : '11:00 AM'),
      complimentary,
      invoiceSent: Boolean(booking.squareInvoiceId),
      invoiceSentAt: booking.friendInvoiceSentAt || booking.invoiceSentAt || booking.approvedAt || null,
      invoiceUrl: booking.paymentUrl || '',
      invoiceStatus: booking.squareInvoiceStatus || (booking.squareInvoiceId ? 'SENT' : 'NOT_SENT'),
      paidCents: complimentary ? 0 : Number(booking.squarePaidCents) || 0,
      balanceCents: complimentary ? 0 : Number(booking.squareBalanceCents ?? booking.amountCents) || 0,
      paymentRequirementMet: complimentary || booking.paymentRequirementMet === true,
      paymentFullyPaid: complimentary || booking.paymentFullyPaid === true,
      agreementAccepted: Boolean(booking.agreementAcceptedAt),
      agreementAcceptedAt: booking.agreementAcceptedAt || null,
      booked: booking.status === 'booked',
      ...doorAccess,
    }, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Your booking packet is temporarily unavailable.' });
  }
}
