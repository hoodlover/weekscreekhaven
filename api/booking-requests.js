import { appendBookingRecord, getBookingCalendar, rangesOverlap, unavailableRanges } from '../_lib/booking-store.js';
import { emailConfigured, escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { json } from '../_lib/security.js';

const text = (value, max = 240) => String(value || '').trim().slice(0, max);
const emailValue = (value) => {
  const email = text(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';

function dateChoice(request, number) {
  return { arrival: isoDate(request.body?.[`arrival${number}`]), departure: isoDate(request.body?.[`departure${number}`]) };
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  try {
    if (text(request.body?.website, 100)) return json(response, 200, { ok: true });
    const name = text(request.body?.name, 100);
    const email = emailValue(request.body?.email);
    const first = dateChoice(request, 1);
    const second = dateChoice(request, 2);
    if (name.length < 2 || !email) return json(response, 400, { error: 'Add your name and a valid email address.' });
    if (!first.arrival || !first.departure || first.departure <= first.arrival) {
      return json(response, 400, { error: 'Choose a valid first arrival and departure.' });
    }
    const hasSecondChoice = Boolean(second.arrival || second.departure);
    if (hasSecondChoice && (!second.arrival || !second.departure || second.departure <= second.arrival)) {
      return json(response, 400, { error: 'Complete both dates for your optional second choice.' });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (first.arrival < today || (hasSecondChoice && second.arrival < today)) return json(response, 400, { error: 'Arrival dates must be in the future.' });
    if (hasSecondChoice && first.arrival === second.arrival && first.departure === second.departure) return json(response, 400, { error: 'Please give us two different date choices.' });
    const unavailable = unavailableRanges(await getBookingCalendar());
    const dateChoices = hasSecondChoice ? [first, second] : [first];
    const unavailableChoices = dateChoices.map((choice) => unavailable.some((range) => rangesOverlap(choice, range)));
    if (unavailableChoices.some(Boolean)) {
      const choices = unavailableChoices.map((blocked, index) => blocked ? `choice ${index + 1}` : '').filter(Boolean).join(' and ');
      return json(response, 409, { error: `Your ${choices} overlaps dates that are already reserved. Please choose another option.`, unavailableChoices });
    }
    const createdAt = new Date().toISOString();
    const booking = {
      id: crypto.randomUUID(), status: 'pending', createdAt, name, email,
      phone: text(request.body?.phone, 40), guests: Math.max(1, Math.min(11, Number(request.body?.guests) || 1)),
      dateChoices, relationship: text(request.body?.relationship, 160),
      reference: text(request.body?.reference, 160), notes: text(request.body?.notes, 800),
    };
    await appendBookingRecord({ type: 'requested', createdAt, booking });
    let confirmationSent = false;
    if (emailConfigured()) {
      const safeName = escapeEmailHtml(name);
      try {
        await sendEmail({
          to: email, toName: name, subject: 'We received your Weeks Creek Haven date request',
          text: `Hi ${name},\n\nWe received your preferred date${hasSecondChoice ? ' choices' : ' choice'} for Weeks Creek Haven. This is a request, not a confirmed reservation. We’ll review the calendar and get back to you with availability, pricing, and next steps.\n\nThank you!`,
          html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">We got your request</h1><p>Hi ${safeName},</p><p>We received your preferred date${hasSecondChoice ? ' choices' : ' choice'} for Weeks Creek Haven.</p><p><strong>This is a request, not a confirmed reservation.</strong> We’ll review the calendar and get back to you with availability, pricing, and next steps.</p><p>Thanks for thinking of the Haven!</p></div>`,
        });
        confirmationSent = true;
        if (process.env.OWNER_EMAIL) {
          await sendEmail({
            to: process.env.OWNER_EMAIL, toName: 'Lance', subject: `New cabin request from ${name}`,
            text: `${name} requested ${first.arrival} to ${first.departure}${hasSecondChoice ? `, or ${second.arrival} to ${second.departure}` : ''}. Review it in the Admin Hub.`,
            html: `<p><strong>${safeName}</strong> submitted a new cabin request.</p><p>Choice 1: ${first.arrival} to ${first.departure}${hasSecondChoice ? `<br>Choice 2: ${second.arrival} to ${second.departure}` : ''}</p><p><a href="https://www.weekscreekhaven.com/admin.html">Review in the Admin Hub</a></p>`,
          });
        }
      } catch (emailError) {
        console.error('Booking request saved but confirmation email failed.', emailError);
      }
    }
    return json(response, 201, { ok: true, requestId: booking.id, confirmationSent });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'We could not save that request. Please try again.' });
  }
}
