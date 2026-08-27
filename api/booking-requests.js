import { appendBookingRecord, getBookingCalendar, rangesOverlap, unavailableRanges } from '../_lib/booking-store.js';
import { emailConfigured, escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { json } from '../_lib/security.js';
import { applyFriendsAndFamilyDiscount, money, quoteStay } from '../pricing.js';

const text = (value, max = 240) => String(value || '').trim().slice(0, max);
const emailValue = (value) => {
  const email = text(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';

function dateChoice(request, number) {
  return { arrival: isoDate(request.body?.[`arrival${number}`]), departure: isoDate(request.body?.[`departure${number}`]) };
}

function nights(choice) {
  return Math.round((Date.parse(`${choice.departure}T00:00:00Z`) - Date.parse(`${choice.arrival}T00:00:00Z`)) / 86400000);
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
    if (nights(first) < 1) return json(response, 400, { error: 'Choose at least one night. One-night stays are billed at the two-night minimum price.' });
    const hasSecondChoice = Boolean(second.arrival || second.departure);
    if (hasSecondChoice && (!second.arrival || !second.departure || second.departure <= second.arrival)) {
      return json(response, 400, { error: 'Complete both dates for your optional second choice.' });
    }
    if (hasSecondChoice && nights(second) < 1) return json(response, 400, { error: 'Every date choice must include at least one night.' });
    const today = new Date().toISOString().slice(0, 10);
    if (first.arrival < today || (hasSecondChoice && second.arrival < today)) return json(response, 400, { error: 'Arrival dates must be in the future.' });
    if (hasSecondChoice && first.arrival === second.arrival && first.departure === second.departure) return json(response, 400, { error: 'Please give us two different date choices.' });
    const calendar = await getBookingCalendar();
    const unavailable = unavailableRanges(calendar);
    const guests = Math.max(1, Math.min(11, Number(request.body?.guests) || 1));
    const dogs = Math.max(0, Math.min(4, Number(request.body?.dogs) || 0));
    const phone = text(request.body?.phone, 40);
    const lateCheckout = ['1', 'true', 'on', true, 1].includes(request.body?.lateCheckout);
    const dateChoices = (hasSecondChoice ? [first, second] : [first]).map((choice) => {
      const standardQuote = quoteStay({ ...choice, guests, dogs, lateCheckout, rates: calendar.rates || [] });
      const quote = applyFriendsAndFamilyDiscount(standardQuote, phone, calendar.discounts || []);
      return { ...choice, amountCents: quote.totalCents, quote };
    });
    const unavailableChoices = dateChoices.map((choice) => unavailable.some((range) => rangesOverlap(choice, range)));
    if (unavailableChoices.some(Boolean)) {
      const choices = unavailableChoices.map((blocked, index) => blocked ? `choice ${index + 1}` : '').filter(Boolean).join(' and ');
      return json(response, 409, { error: `Your ${choices} overlaps dates that are already reserved. Please choose another option.`, unavailableChoices });
    }
    const createdAt = new Date().toISOString();
    const booking = {
      id: crypto.randomUUID(), status: 'pending', createdAt, name, email,
      phone, guests, dogs, lateCheckout, pricingVersion: 1,
      friendsAndFamilyDiscount: dateChoices[0].quote.friendsAndFamilyDiscount || null,
      dateChoices, relationship: text(request.body?.relationship, 160),
      reference: text(request.body?.reference, 160), notes: text(request.body?.notes, 800),
    };
    await appendBookingRecord({ type: 'requested', createdAt, booking });
    let confirmationSent = false;
    if (emailConfigured()) {
      const safeName = escapeEmailHtml(name);
      const firstQuote = dateChoices[0].quote;
      const complimentaryMessage = firstQuote.complimentary
        ? ` Welcome! Your stay is complimentary: $0 due, with no taxes or government lodging fees.`
        : firstQuote.friendsAndFamilyDiscount
          ? ` Welcome! Your ${firstQuote.friendsAndFamilyDiscount.label} gives you a discounted rate of ${money(dateChoices[0].amountCents)} for choice 1, saving ${money(firstQuote.discountAmountCents)}.`
          : ` Your current estimate for choice 1 is ${money(dateChoices[0].amountCents)}.`;
      const priceMessage = firstQuote.complimentary
        ? ''
        : ` This price does not include an estimated ${money(firstQuote.estimatedTaxesAndFeesCents)} in taxes and government lodging fees; the estimated amount if booked is ${money(firstQuote.estimatedGrandTotalCents)}. The standard $200 cleaning cost is included.`;
      const complimentaryHtml = firstQuote.complimentary
        ? '<p style="background:#e8f2e9;padding:14px;border-radius:10px"><strong>Welcome!</strong> This is a complimentary stay: <strong>$0 due</strong>, with no taxes or government lodging fees.</p>'
        : firstQuote.friendsAndFamilyDiscount
          ? `<p style="background:#e8f2e9;padding:14px;border-radius:10px"><strong>Welcome!</strong> Your ${escapeEmailHtml(firstQuote.friendsAndFamilyDiscount.label)} gives you a discounted rate of <strong>${money(dateChoices[0].amountCents)}</strong> for choice 1. You save ${money(firstQuote.discountAmountCents)}.</p>`
          : `<p>Current choice 1 estimate: <strong>${money(dateChoices[0].amountCents)}</strong></p>`;
      const priceHtml = firstQuote.complimentary ? '' : `<p>Price does not include <strong>${money(firstQuote.estimatedTaxesAndFeesCents)}</strong> in estimated taxes and government lodging fees.<br>Estimated amount if booked: <strong>${money(firstQuote.estimatedGrandTotalCents)}</strong></p>`;
      try {
        await sendEmail({
          to: email, toName: name, subject: 'We received your Weeks Creek Haven date request',
          text: `Hi ${name},\n\nWe received your preferred date${hasSecondChoice ? ' choices' : ' choice'} for Weeks Creek Haven.${complimentaryMessage}${priceMessage}${lateCheckout && !firstQuote.complimentary ? ' Your estimate includes the $50 noon checkout option.' : ' Standard checkout is 11:00 AM.'} Check-in begins at 4:00 PM. This is a request, not a confirmed reservation.\n\nThank you!`,
          html: `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">We got your request</h1><p>Hi ${safeName},</p><p>We received your preferred date${hasSecondChoice ? ' choices' : ' choice'} for Weeks Creek Haven.</p>${complimentaryHtml}${priceHtml}<p><span style="color:#74685e">${firstQuote.complimentary?'No payment required':`Standard $200 cleaning cost included · ${lateCheckout ? '$50 noon checkout included' : '11:00 AM checkout'}`} · 4:00 PM check-in</span></p><p><strong>This is a request, not a confirmed reservation.</strong> We’ll review the calendar and get back to you with availability and next steps.</p><p>Thanks for thinking of the Haven!</p></div>`,
        });
        confirmationSent = true;
        if (process.env.OWNER_EMAIL) {
          await sendEmail({
            to: process.env.OWNER_EMAIL, toName: 'Lance', subject: `New cabin request from ${name}`,
            text: `${name} requested ${first.arrival} to ${first.departure} (${money(dateChoices[0].amountCents)})${hasSecondChoice ? `, or ${second.arrival} to ${second.departure} (${money(dateChoices[1].amountCents)})` : ''}.${dateChoices[0].quote.friendsAndFamilyDiscount ? ` Friends & Family rule applied: ${dateChoices[0].quote.friendsAndFamilyDiscount.label}, saving ${money(dateChoices[0].quote.discountAmountCents)} on choice 1.` : ''}${lateCheckout ? ' Includes the $50 noon checkout option.' : ' Standard 11:00 AM checkout.'} Review it in the Admin Hub.`,
            html: `<p><strong>${safeName}</strong> submitted a new cabin request for ${guests} guest${guests === 1 ? '' : 's'}${dogs?` and ${dogs} dog${dogs===1?'':'s'}`:''}.</p><p>Choice 1: ${first.arrival} to ${first.departure} · <strong>${money(dateChoices[0].amountCents)}</strong>${hasSecondChoice ? `<br>Choice 2: ${second.arrival} to ${second.departure} · <strong>${money(dateChoices[1].amountCents)}</strong>` : ''}</p>${dateChoices[0].quote.friendsAndFamilyDiscount ? `<p><strong>${escapeEmailHtml(dateChoices[0].quote.friendsAndFamilyDiscount.label)} applied:</strong> ${money(dateChoices[0].quote.discountAmountCents)} savings on choice 1.</p>` : ''}<p>${lateCheckout ? '<strong>$50 noon checkout requested.</strong>' : 'Standard 11:00 AM checkout.'} Check-in is 4:00 PM.</p><p><a href="https://www.weekscreekhaven.com/admin.html">Review in the Admin Hub</a></p>`,
          });
        }
      } catch (emailError) {
        console.error('Booking request saved but confirmation email failed.', emailError);
      }
    }
    return json(response, 201, { ok: true, requestId: booking.id, confirmationSent, quotes: dateChoices.map((choice) => choice.quote) });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'We could not save that request. Please try again.' });
  }
}
