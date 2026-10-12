import { appendBookingRecord, getBookingCalendar } from '../_lib/booking-store.js';
import { json, requireAdmin, sameOriginRequest } from '../_lib/security.js';
import { roundUpCents } from '../pricing.js';
import { normalizedPhone as normalizePhone, normalizedEmail, discountPhone, discountEmail } from '../guest-identity.js';

const safeText = (value, max = 120) => String(value || '').trim().slice(0, max);

function contactValues(phoneValue, emailValue) {
  const phone = normalizePhone(phoneValue), email = normalizedEmail(emailValue);
  if (!phone) throw new Error('Add a valid 10-digit phone number so this guest can find their profile discount.');
  if (String(emailValue || '').trim() && !email) throw new Error('Enter a valid email or leave it blank.');
  return { matchType: phone ? 'phone' : 'email', target: phone || email, email };
}

function parseContactLine(value) {
  let line = String(value || '').trim();
  const emailToken = line.match(/\S+@\S+/)?.[0] || '';
  if (emailToken) line = line.replace(emailToken, '').trim();
  const phoneToken = line.match(/^(?:\+?1[\s().-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}(?=\s|$)/)?.[0] || '';
  if (phoneToken) line = line.slice(phoneToken.length).trim();
  if (!phoneToken && /^\+?\d/.test(line)) throw new Error('A phone number is incomplete. Use one contact per line: phone, optional email, then welcome name.');
  return { ...contactValues(phoneToken, emailToken), guestName: safeText(line, 60) };
}

function contactsOverlap(a, b) {
  return Boolean((discountPhone(a) && discountPhone(a) === discountPhone(b)) || (discountEmail(a) && discountEmail(a) === discountEmail(b)));
}

function pricingValues(body) {
  const discountType = ['percentage', 'amount', 'flat', 'complimentary'].includes(body?.discountType) ? body.discountType : 'percentage';
  const enteredValue = discountType === 'complimentary' ? 0 : Number(body?.value);
  if (!Number.isFinite(enteredValue) || enteredValue < 0) throw new Error('Enter a valid discount amount.');
  if (discountType === 'percentage' && (enteredValue <= 0 || enteredValue > 100)) throw new Error('Percentage discounts must be from 1% through 100%.');
  if (discountType === 'amount' && enteredValue < 5) throw new Error('Dollar discounts must be at least $5.');
  const customFeeValue = Number(body?.customFee || 0);
  if (!Number.isFinite(customFeeValue) || customFeeValue < 0) throw new Error('Enter a valid optional required fee.');
  const customFeeCents = roundUpCents(Math.round(customFeeValue * 100));
  return {
    discountType,
    label: safeText(body?.label, 80) || (discountType === 'complimentary' ? 'Our guest · complimentary stay' : 'Friends & Family rate'),
    percentage: discountType === 'percentage' ? enteredValue : null,
    amountOffCents: discountType === 'amount' ? roundUpCents(Math.round(enteredValue * 100)) : null,
    flatTotalCents: discountType === 'flat' ? roundUpCents(Math.round(enteredValue * 100)) : null,
    chargeCleaning: false,
    chargeDogFee: discountType === 'complimentary' ? false : Boolean(body?.chargeDogFee),
    chargeLateCheckout: discountType === 'complimentary' ? false : Boolean(body?.chargeLateCheckout),
    customFeeLabel: discountType !== 'complimentary' && customFeeCents ? safeText(body?.customFeeLabel, 60) || 'Required fee' : '',
    customFeeCents: discountType === 'complimentary' ? 0 : customFeeCents,
  };
}

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  if (request.method !== 'GET' && !sameOriginRequest(request)) return json(response, 403, { error: 'Open the owner page directly from this website.' });
  try {
    if (request.method === 'GET') {
      const calendar = await getBookingCalendar();
      const discounts = calendar.discounts || [];
      const kirbyBooking = (calendar.bookings || []).find((booking) => /kirby\s*crew/i.test(String(booking.name || '')) && normalizePhone(booking.phone));
      const kirbyPhone = normalizePhone(kirbyBooking?.phone);
      if (kirbyBooking && kirbyPhone && !discounts.some((rule) => rule.target === kirbyPhone)) {
        const createdAt = new Date().toISOString();
        const discount = {
          id: `kirby-crew-${kirbyPhone}`, matchType: 'phone', target: kirbyPhone,
          guestName: safeText(kirbyBooking.name, 60) || 'Kirby Crew', discountType: 'flat',
          label: 'Friends & Family rate', percentage: null, amountOffCents: null, flatTotalCents: 3000,
          chargeCleaning: false, chargeDogFee: false, chargeLateCheckout: false,
          customFeeLabel: '', customFeeCents: 0, createdAt,
        };
        await appendBookingRecord({ type: 'discount_created', discount, createdAt });
        discounts.unshift(discount);
      }
      return json(response, 200, { discounts }, { 'Cache-Control': 'no-store' });
    }
    const createdAt = new Date().toISOString();
    if (request.method === 'POST') {
      const suppliedTargets = String(request.body?.target || '').split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
      let parsedTargets;
      try { parsedTargets = suppliedTargets.map(parseContactLine); } catch (error) { return json(response, 400, { error: error.message }); }
      if (!parsedTargets.length) return json(response, 400, { error: 'Enter at least one phone number.' });
      let values;
      try { values = pricingValues(request.body); } catch (error) { return json(response, 400, { error: error.message }); }
      const calendar = await getBookingCalendar();
      const existing = calendar.discounts || [];
      if (parsedTargets.some((contact, index) => [...existing, ...parsedTargets.slice(0, index)].some((other) => contactsOverlap(contact, other)))) return json(response, 409, { error: 'A phone number or email already belongs to a contact. Edit that contact, or remove the duplicate line.' });
      const discounts = parsedTargets.map((contact) => ({
        id: crypto.randomUUID(), ...contact, ...values,
        createdAt,
      }));
      for (const discount of discounts) await appendBookingRecord({ type: 'discount_created', discount, createdAt });
      return json(response, 201, { discounts, skipped: 0 });
    }
    if (request.method === 'PATCH') {
      const discountId = safeText(request.body?.discountId, 80);
      const calendar = await getBookingCalendar();
      const current = (calendar.discounts || []).find((rule) => rule.id === discountId);
      if (!current) return json(response, 404, { error: 'Friends & Family contact not found.' });
      let contact;
      try { contact = contactValues(request.body?.target, request.body?.email ?? discountEmail(current)); } catch (error) { return json(response, 400, { error: error.message }); }
      const guestName = safeText(request.body?.guestName, 60);
      if ((calendar.discounts || []).some((rule) => rule.id !== discountId && contactsOverlap(rule, contact))) return json(response, 409, { error: 'That phone number or email already belongs to another contact.' });
      let values;
      try { values = pricingValues(request.body); } catch (error) { return json(response, 400, { error: error.message }); }
      const discount = { ...current, ...contact, guestName, ...values, updatedAt: createdAt };
      await appendBookingRecord({ type: 'discount_updated', discount, createdAt });
      return json(response, 200, { discount });
    }
    if (request.method === 'DELETE') {
      const discountId = safeText(request.body?.discountId, 80);
      const calendar = await getBookingCalendar();
      if (!(calendar.discounts || []).some((rule) => rule.id === discountId)) return json(response, 404, { error: 'Discount rule not found.' });
      await appendBookingRecord({ type: 'discount_removed', discountId, createdAt });
      return json(response, 200, { ok: true });
    }
    return json(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'The discount list is temporarily unavailable.' });
  }
}
