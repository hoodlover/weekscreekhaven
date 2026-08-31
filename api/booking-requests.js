import { appendBookingRecord, getBookingCalendar, rangesOverlap, unavailableRanges } from '../_lib/booking-store.js';
import { emailConfigured, escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { createAgreementToken, enforceRateLimit, json, rateLimitJson, requireInvite, sameOriginRequest } from '../_lib/security.js';
import { applyFriendsAndFamilyDiscount, money, quoteStay } from '../pricing.js';
import { automaticallyApproveBooking } from '../_lib/auto-booking.js';
import { getInvites } from '../_lib/invite-store.js';
import { applyInviteComplimentary } from '../_lib/invite-pricing.js';

const text = (value, max = 240) => String(value || '').trim().slice(0, max);
const emailValue = (value) => {
  const email = text(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};
const isoDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';

function dateChoice(request, number) {
  return {
    arrival: isoDate(request.body?.[`arrival${number}`]), departure: isoDate(request.body?.[`departure${number}`]),
    discountRequest: text(request.body?.[`discountRequest${number}`], 160),
  };
}

function nights(choice) {
  return Math.round((Date.parse(`${choice.departure}T00:00:00Z`) - Date.parse(`${choice.arrival}T00:00:00Z`)) / 86400000);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  if (!sameOriginRequest(request)) return json(response, 403, { error: 'Please submit your booking directly from weekscreekhaven.com.' });
  const rate = enforceRateLimit(request, 'public-booking', 5, 60 * 60 * 1000);
  if (!rate.allowed) return rateLimitJson(response, rate);
  try {
    if (text(request.body?.website, 100)) return json(response, 200, { ok: true });
  const formStartedAt = Number(request.body?.formStartedAt);
  if (!Number.isFinite(formStartedAt) || Date.now() - formStartedAt < 2000 || Date.now() - formStartedAt > 6 * 60 * 60 * 1000) {
    return json(response, 400, { error: 'Please refresh the booking page and try again.' });
  }
    const inviteSession = requireInvite(request);
    const invites = inviteSession && !String(inviteSession.visitorName || '').includes('owner preview') ? await getInvites() : [];
    const activeInvite = invites.find((item) => item.id === inviteSession?.inviteId && !item.archivedAt && !item.revokedAt && (!item.expiresAt || Date.parse(item.expiresAt) >= Date.now()));
    const name = text(activeInvite?.label || request.body?.name, 100);
    const email = emailValue(activeInvite?.recipientEmail || request.body?.email);
    const first = dateChoice(request, 1);
    if (name.length < 2 || !email) return json(response, 400, { error: 'Add your name and a valid email address.' });
    if (!first.arrival || !first.departure || first.departure <= first.arrival) {
      return json(response, 400, { error: 'Choose a valid arrival and departure.' });
    }
    if (nights(first) < 1) return json(response, 400, { error: 'Choose at least one night. One-night stays are billed at the two-night minimum price.' });
    const today = new Date().toISOString().slice(0, 10);
    if (first.arrival < today) return json(response, 400, { error: 'Arrival dates must be in the future.' });
    const calendar = await getBookingCalendar();
    const unavailable = unavailableRanges(calendar);
    const guests = Math.max(1, Math.min(11, Number(request.body?.guests) || 1));
    const dogs = Math.max(0, Math.min(4, Number(request.body?.dogs) || 0));
    const phone = text(activeInvite?.recipientPhone || request.body?.phone, 40);
  const phoneDigits = phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const billingAddress = text(request.body?.billingAddress, 160);
  const billingCity = text(request.body?.billingCity, 80);
  const billingState = text(request.body?.billingState, 2).toUpperCase();
  const billingPostalCode = text(request.body?.billingPostalCode, 10);
  const guestNames = text(request.body?.guestNames, 500);
  const vehicleCount = Math.max(0, Math.min(6, Number(request.body?.vehicleCount) || 0));
  const ageConfirmed = ['1', 'true', 'on', true, 1].includes(request.body?.ageConfirmed);
  const primaryGuestStaying = ['1', 'true', 'on', true, 1].includes(request.body?.primaryGuestStaying);
  const privacyAccepted = ['1', 'true', 'on', true, 1].includes(request.body?.privacyAccepted);
  const bookingIntent = request.body?.bookingIntent === 'questions' ? 'questions' : 'checkout';
  const ownerQuestions = text(request.body?.ownerQuestions, 1000);
  if (phoneDigits.length !== 10 || !billingAddress || !billingCity || !/^[A-Z]{2}$/.test(billingState) || !/^\d{5}(?:-\d{4})?$/.test(billingPostalCode)) {
    return json(response, 400, { error: 'Add a valid phone number and complete billing address.' });
  }
  if (!ageConfirmed || !primaryGuestStaying || !privacyAccepted) {
    return json(response, 400, { error: 'Confirm the primary guest, minimum age, and privacy notice.' });
  }
  if (bookingIntent === 'questions' && ownerQuestions.length < 2) return json(response, 400, { error: 'Add your question for the owners.' });
  if (guests > 1 && guestNames.length < 2) return json(response, 400, { error: 'List the other registered guests in your party.' });
    const lateCheckout = ['1', 'true', 'on', true, 1].includes(request.body?.lateCheckout);
    const dateChoices = [first].map((choice) => {
      const standardQuote = quoteStay({ ...choice, guests, dogs, lateCheckout, rates: calendar.rates || [] });
      const discountedQuote = applyFriendsAndFamilyDiscount(standardQuote, phone, calendar.discounts || []);
      const quote = applyInviteComplimentary(discountedQuote, activeInvite);
      return { ...choice, amountCents: quote.totalCents, quote };
    });
    const unavailableChoices = dateChoices.map((choice) => unavailable.some((range) => rangesOverlap(choice, range)));
    if (unavailableChoices.some(Boolean)) {
      const choices = unavailableChoices.map((blocked, index) => blocked ? `choice ${index + 1}` : '').filter(Boolean).join(' and ');
      return json(response, 409, { error: `Your ${choices} overlaps dates that are already reserved. Please choose another option.`, unavailableChoices });
    }
    const createdAt = new Date().toISOString();
    const inquiryExpiresAt = bookingIntent === 'questions' ? new Date(Date.parse(createdAt) + 48 * 60 * 60 * 1000).toISOString() : null;
    const booking = {
      id: crypto.randomUUID(), status: 'pending', createdAt, name, email,
      inviteId: activeInvite?.id || null, source: activeInvite ? 'invite-booking' : 'public-booking',
      phone, billingAddress, billingCity, billingState, billingPostalCode, guestNames, vehicleCount,
      ageConfirmed, primaryGuestStaying, privacyAcceptedAt: createdAt,
      guests, dogs, lateCheckout, pricingVersion: 2,
      friendsAndFamilyDiscount: dateChoices[0].quote.friendsAndFamilyDiscount || null,
      friendsPaymentChoice: request.body?.friendsPaymentChoice === 'full' ? 'full' : 'deposit',
      dateChoices, relationship: text(request.body?.relationship, 160),
      reference: text(request.body?.reference, 160), discountRequest: first.discountRequest,
      bookingIntent, ownerQuestions, inquiryExpiresAt,
      notes: [first.discountRequest ? `Requested offer: ${first.discountRequest}` : '', ownerQuestions ? `Questions for owners: ${ownerQuestions}` : '', text(request.body?.notes, 800)].filter(Boolean).join('\n'),
    };
    await appendBookingRecord({ type: 'requested', createdAt, booking });
    const approvedBooking=bookingIntent==='questions'?booking:await automaticallyApproveBooking(booking);
    let confirmationSent = true;
    if (emailConfigured() && !approvedBooking.autoApproved) {
      const safeName = escapeEmailHtml(name);
      const firstQuote = dateChoices[0].quote;
      const complimentaryMessage = firstQuote.complimentary
        ? ` Welcome! Your stay is complimentary: $0 due, with no taxes or government lodging fees.`
        : firstQuote.friendsAndFamilyDiscount
          ? ` Welcome! Your ${firstQuote.friendsAndFamilyDiscount.label} gives you a discounted rate of ${money(dateChoices[0].amountCents)}, saving ${money(firstQuote.discountAmountCents)}.`
          : firstQuote.earlyBirdDiscount
            ? ` Your automatic ${firstQuote.earlyBirdDiscount.percentage}% Early Bird price is ${money(dateChoices[0].amountCents)}, saving ${money(firstQuote.earlyBirdDiscountCents)}.`
            : ` Your current estimate is ${money(dateChoices[0].amountCents)}.`;
      const priceMessage = firstQuote.complimentary
        ? ''
        : ` This price does not include an estimated ${money(firstQuote.estimatedTaxesAndFeesCents)} in taxes and government lodging fees; the estimated amount if booked is ${money(firstQuote.estimatedGrandTotalCents)}. The standard $200 cleaning cost is included.`;
      const complimentaryHtml = firstQuote.complimentary
        ? '<p style="background:#e8f2e9;padding:14px;border-radius:10px"><strong>Welcome!</strong> This is a complimentary stay: <strong>$0 due</strong>, with no taxes or government lodging fees.</p>'
        : firstQuote.friendsAndFamilyDiscount
          ? `<p style="background:#e8f2e9;padding:14px;border-radius:10px"><strong>Welcome!</strong> Your ${escapeEmailHtml(firstQuote.friendsAndFamilyDiscount.label)} gives you a discounted rate of <strong>${money(dateChoices[0].amountCents)}</strong>. You save ${money(firstQuote.discountAmountCents)}.</p>`
          : firstQuote.earlyBirdDiscount
            ? `<p style="background:#e8f2e9;padding:14px;border-radius:10px"><strong>Automatic Early Bird:</strong> ${firstQuote.earlyBirdDiscount.percentage}% off is already included. Your estimate is <strong>${money(dateChoices[0].amountCents)}</strong>, saving ${money(firstQuote.earlyBirdDiscountCents)}.</p>`
            : `<p>Current estimate: <strong>${money(dateChoices[0].amountCents)}</strong></p>`;
      const priceHtml = firstQuote.complimentary ? '' : `<p>Price does not include <strong>${money(firstQuote.estimatedTaxesAndFeesCents)}</strong> in estimated taxes and government lodging fees.<br>Estimated amount if booked: <strong>${money(firstQuote.estimatedGrandTotalCents)}</strong></p>`;
      const friendsAndFamily = Boolean(firstQuote.friendsAndFamilyDiscount);
      const checkoutText = friendsAndFamily
        ? ' Friends & Family checkout is flexible with no set time unless Lance or Heather lets you know personally.'
        : (lateCheckout && !firstQuote.complimentary ? ' Your estimate includes the $50 noon checkout option.' : ' Standard checkout is 11:00 AM.');
      const checkoutSummary = friendsAndFamily
        ? 'Flexible Friends & Family checkout'
        : (lateCheckout ? '$50 noon checkout included' : '11:00 AM checkout');
      try {
        await sendEmail({
          to: email, toName: name, subject: bookingIntent==='questions'?'We received your Weeks Creek Haven questions':'We received your Weeks Creek Haven date request',
          templateKey:'request-received', templateVariables:{ guestName:name },
          text: bookingIntent==='questions'?`Hi ${name},\n\nWe received your selected dates (${first.arrival} through ${first.departure}) and your questions:\n\n${ownerQuestions}\n\nNo invoice was created. Lance or Heather will respond. This inquiry remains active for 48 hours, then is automatically archived and removed from the calendar.\n\nThank you!`:`Hi ${name},\n\nWe received your selected stay dates for Weeks Creek Haven.${complimentaryMessage}${priceMessage}${checkoutText} Check-in begins at 4:00 PM. The dates lock after payment and the rental agreement are both complete.\n\nThank you!`,
          html: bookingIntent==='questions'?`<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">We received your questions</h1><p>Hi ${safeName},</p><p>We received your selected dates: <strong>${first.arrival} through ${first.departure}</strong>.</p><p><strong>Your questions:</strong><br>${escapeEmailHtml(ownerQuestions)}</p><p>No invoice was created. Lance or Heather will respond. These dates remain available until payment and the rental agreement are complete.</p></div>`:`<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.6;max-width:600px"><h1 style="color:#183c2d">We received your date request</h1><p>Hi ${safeName},</p><p>We received your selected stay dates for Weeks Creek Haven.</p>${complimentaryHtml}${priceHtml}<p><span style="color:#74685e">${firstQuote.complimentary?'No payment required':`Standard $200 cleaning cost included · ${checkoutSummary}`} · 4:00 PM check-in</span></p><p><strong>Your dates lock after payment and the rental agreement are both complete.</strong></p><p>Thanks for thinking of the Haven!</p></div>`,
        });
        confirmationSent = true;
        if (process.env.OWNER_EMAIL) {
          await sendEmail({
            to: process.env.OWNER_EMAIL, toName: 'Lance', subject: `New cabin request from ${name}`,
            templateKey:'owner-new-request', templateVariables:{ guestName:name, adminUrl:'https://www.weekscreekhaven.com/admin.html' },
            text: `${name} selected ${first.arrival} to ${first.departure} (${money(dateChoices[0].amountCents)}).${bookingIntent==='questions'?` Questions: ${ownerQuestions}`:''}${first.discountRequest?` Requested offer: ${first.discountRequest}.`:''}${dateChoices[0].quote.friendsAndFamilyDiscount ? ` Friends & Family rule applied: ${dateChoices[0].quote.friendsAndFamilyDiscount.label}, saving ${money(dateChoices[0].quote.discountAmountCents)}.` : ''} ${checkoutSummary}. Review it in the Admin Hub.`,
            html: `<p><strong>${safeName}</strong> submitted ${bookingIntent==='questions'?'dates and questions':'a new cabin booking request'} for ${guests} guest${guests === 1 ? '' : 's'}${dogs?` and ${dogs} dog${dogs===1?'':'s'}`:''}.</p><p>${first.arrival} to ${first.departure} · <strong>${money(dateChoices[0].amountCents)}</strong></p>${bookingIntent==='questions'?`<p><strong>Questions:</strong><br>${escapeEmailHtml(ownerQuestions)}</p>`:''}${dateChoices[0].quote.friendsAndFamilyDiscount ? `<p><strong>${escapeEmailHtml(dateChoices[0].quote.friendsAndFamilyDiscount.label)} applied:</strong> ${money(dateChoices[0].quote.discountAmountCents)} savings.</p>` : ''}<p>${escapeEmailHtml(checkoutSummary)}. Check-in is 4:00 PM.</p><p><a href="https://www.weekscreekhaven.com/admin.html">Review in the Admin Hub</a></p>`,
          });
        }
      } catch (emailError) {
        console.error('Booking request saved but confirmation email failed.', emailError);
      }
    }
    if (bookingIntent!=='questions' && emailConfigured() && process.env.OWNER_EMAIL) {
      try { await sendEmail({to:process.env.OWNER_EMAIL,toName:'Lance',templateKey:'owner-new-request',templateVariables:{guestName:name,adminUrl:'https://www.weekscreekhaven.com/admin.html'},subject:`Automatically accepted stay for ${name}`,text:`${name}'s stay from ${first.arrival} through ${first.departure} was accepted automatically. Review it in the Admin Hub.`,html:`<p><strong>${escapeEmailHtml(name)}</strong> was automatically accepted for <strong>${first.arrival} through ${first.departure}</strong>.</p><p><a href="https://www.weekscreekhaven.com/admin.html">Review in the Admin Hub</a></p>`}); } catch(error) { console.error('Owner auto-booking alert failed',error); }
    }
    const bookingPacketUrl = bookingIntent === 'questions' ? null : `/booking-packet.html?token=${encodeURIComponent(createAgreementToken(booking.id, 365 * 86400))}`;
    return json(response, 201, { ok: true, requestId: booking.id, autoApproved:Boolean(approvedBooking.autoApproved), questionsOnly:bookingIntent==='questions', paymentUrl:approvedBooking.paymentUrl||null, bookingPacketUrl, confirmationSent, quotes: dateChoices.map((choice) => choice.quote) });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'We could not save that request. Please try again.' });
  }
}
