import { appendBookingRecord, getBookingCalendar } from '../_lib/booking-store.js';
import { json, requireAdmin } from '../_lib/security.js';
import { roundUpCents } from '../pricing.js';

const safeText = (value, max = 120) => String(value || '').trim().slice(0, max);

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const normalized = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return normalized.length === 10 ? normalized : '';
}

function parsePhoneLine(value) {
  const line = String(value || '').trim();
  const target = normalizePhone(line);
  const guestName = safeText(line.replace(/^\s*(?:\+?1[\s().-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}\s*/, ''), 60);
  return { target, guestName };
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
    chargeCleaning: discountType === 'complimentary' ? false : Boolean(body?.chargeCleaning),
    chargeDogFee: discountType === 'complimentary' ? false : Boolean(body?.chargeDogFee),
    chargeLateCheckout: discountType === 'complimentary' ? false : Boolean(body?.chargeLateCheckout),
    customFeeLabel: discountType !== 'complimentary' && customFeeCents ? safeText(body?.customFeeLabel, 60) || 'Required fee' : '',
    customFeeCents: discountType === 'complimentary' ? 0 : customFeeCents,
  };
}

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') {
      const calendar = await getBookingCalendar();
      return json(response, 200, { discounts: calendar.discounts || [] }, { 'Cache-Control': 'no-store' });
    }
    const createdAt = new Date().toISOString();
    if (request.method === 'POST') {
      const suppliedTargets = String(request.body?.target || '').split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
      const parsedTargets = suppliedTargets.map(parsePhoneLine);
      if (!parsedTargets.length) return json(response, 400, { error: 'Enter at least one valid 10-digit phone number.' });
      if (parsedTargets.some((item) => !item.target)) return json(response, 400, { error: 'At least one phone number is incomplete. Use one 10-digit U.S. number and display name on each line.' });
      let values;
      try { values = pricingValues(request.body); } catch (error) { return json(response, 400, { error: error.message }); }
      const calendar = await getBookingCalendar();
      const existing = new Set((calendar.discounts || []).filter((rule) => rule.matchType === 'phone').map((rule) => rule.target));
      const uniqueTargets = [...new Map(parsedTargets.map((item) => [item.target, item])).values()].filter((item) => !existing.has(item.target));
      if (!uniqueTargets.length) return json(response, 409, { error: 'Every phone number entered already has a rule. Remove an old rule before replacing it.' });
      const discounts = uniqueTargets.map(({ target, guestName }) => ({
        id: crypto.randomUUID(), matchType: 'phone', target, guestName, ...values,
        createdAt,
      }));
      for (const discount of discounts) await appendBookingRecord({ type: 'discount_created', discount, createdAt });
      return json(response, 201, { discounts, skipped: parsedTargets.length - uniqueTargets.length });
    }
    if (request.method === 'PATCH') {
      const discountId = safeText(request.body?.discountId, 80);
      const calendar = await getBookingCalendar();
      const current = (calendar.discounts || []).find((rule) => rule.id === discountId);
      if (!current) return json(response, 404, { error: 'Friends & Family contact not found.' });
      const target = normalizePhone(request.body?.target);
      const guestName = safeText(request.body?.guestName, 60);
      if (!target) return json(response, 400, { error: 'Enter a complete 10-digit U.S. phone number.' });
      if ((calendar.discounts || []).some((rule) => rule.id !== discountId && rule.target === target)) return json(response, 409, { error: 'That phone number already belongs to another contact.' });
      let values;
      try { values = pricingValues(request.body); } catch (error) { return json(response, 400, { error: error.message }); }
      const discount = { ...current, matchType: 'phone', target, guestName, ...values, updatedAt: createdAt };
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
