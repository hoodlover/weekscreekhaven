import { appendBookingRecord, getBookingCalendar } from '../_lib/booking-store.js';
import { escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { getInvites } from '../_lib/invite-store.js';
import { json, requireInvite } from '../_lib/security.js';

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00Z`));
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  const session = requireInvite(request);
  if (!session) return json(response, 401, { error: 'Please use your invitation to sign in again.' });
  try {
    const [invites, calendar] = await Promise.all([getInvites(), getBookingCalendar()]);
    const invite = invites.find((item) => item.id === session.inviteId);
    const expiredInvite = invite?.expiresAt && new Date(invite.expiresAt).getTime() < Date.now();
    if (!invite || invite.revokedAt || expiredInvite) return json(response, 403, { error: 'This invitation is no longer active.' });
    const booking = invite.bookingId ? calendar.bookings.find((item) => item.id === invite.bookingId) : null;
    if (!booking) return json(response, 404, { error: 'These stay choices could not be found.' });
    const choiceIndex = Number(request.body?.choice) - 1;
    const option = booking.dateChoices?.[choiceIndex];
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || !option) return json(response, 400, { error: 'Choose one of the offered stays.' });
    if (option.expiresOn && option.expiresOn < easternToday()) return json(response, 409, { error: 'That option has expired. Another unexpired choice may still be available.' });
    if (['reserved', 'booked'].includes(booking.status)) {
      if (booking.approvedChoice === choiceIndex) return json(response, 200, { ok: true, alreadySelected: true, selectedStayChoice: choiceIndex });
      return json(response, 409, { error: 'A stay choice has already been selected for this invitation.' });
    }
    if (booking.status !== 'offered') return json(response, 409, { error: 'These stay choices are no longer available.' });
    const selectedAt = new Date().toISOString();
    await appendBookingRecord({ type: 'status', bookingId: booking.id, changes: { status: 'reserved', approvedChoice: choiceIndex, amountCents: option.amountCents || undefined, reservedAt: selectedAt, selectedByGuestAt: selectedAt }, createdAt: selectedAt });
    const costText = option.amountCents ? ` The listed cost is $${(option.amountCents / 100).toFixed(2)}.` : '';
    const safeName = escapeEmailHtml(invite.label);
    const safeDates = `${formatDate(option.arrival)} through ${formatDate(option.departure)}`;
    const guestEmail = invite.recipientEmail;
    const emailTasks = [];
    if (guestEmail) emailTasks.push(sendEmail({
      to: guestEmail, toName: invite.label, subject: 'Your Weeks Creek Haven stay choice is reserved',
      text: `Hi ${invite.label},\n\nYou chose ${safeDates}.${costText} We released the other offered dates. We will follow up with any remaining payment or stay details.`,
      html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">Your stay choice is reserved</h1><p>Hi ${safeName},</p><p>You chose <strong>${safeDates}</strong>.</p>${option.amountCents ? `<p>Listed cost: <strong>$${(option.amountCents / 100).toFixed(2)}</strong></p>` : ''}<p>We released the other offered dates. We will follow up with any remaining payment or stay details.</p></div>`,
    }));
    if (process.env.OWNER_EMAIL) emailTasks.push(sendEmail({
      to: process.env.OWNER_EMAIL, toName: 'Lance', subject: `${invite.label} chose their Weeks Creek Haven dates`,
      text: `${invite.label} chose ${safeDates}.${costText} The other offered dates were released.`,
      html: `<p><strong>${safeName}</strong> chose <strong>${safeDates}</strong>.</p>${option.amountCents ? `<p>Listed cost: <strong>$${(option.amountCents / 100).toFixed(2)}</strong></p>` : ''}<p>The other offered dates were released. <a href="https://www.weekscreekhaven.com/calendar.html">Open the owner calendar</a>.</p>`,
    }));
    const emailResults = await Promise.allSettled(emailTasks);
    const warning = emailResults.some((result) => result.status === 'rejected') ? 'Your dates were reserved, but one confirmation email could not be delivered.' : null;
    return json(response, 200, { ok: true, selectedStayChoice: choiceIndex, warning });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'Your stay choice could not be saved.' });
  }
}
