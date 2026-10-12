import { applyFriendsAndFamilyDiscount, quoteStay } from '../pricing.js';
import { applyInviteComplimentary } from './invite-pricing.js';
export { totalWithDeposit } from '../booking-price.js';

export function validStayDates(arrival, departure) {
  const valid = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return valid(arrival) && valid(departure) && departure > arrival && (Date.parse(departure) - Date.parse(arrival)) / 86400000 <= 365;
}

export function pricingIdentity(input, invite) {
  return { phone: invite ? invite.recipientPhone || '' : input.phone };
}

export function guestQuote(input, calendar, invite) {
  if (!validStayDates(input.arrival, input.departure)) return null;
  const standard = quoteStay({ ...input, rates: calendar.rates || [] });
  return applyInviteComplimentary(applyFriendsAndFamilyDiscount(standard, pricingIdentity(input, invite), calendar.discounts || []), invite);
}
