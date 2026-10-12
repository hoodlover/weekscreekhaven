import { money } from './pricing.js';

export function securityDepositCents(quote) {
  return quote.complimentary ? 0 : quote.friendsAndFamilyDiscount ? 5000 : 30000;
}

export function totalWithDeposit(quote) {
  return quote.estimatedGrandTotalCents + securityDepositCents(quote);
}

export function discountDescription(quote) {
  const rule = quote.friendsAndFamilyDiscount;
  const saving = money(quote.discountAmountCents || 0);
  if (quote.complimentary) return `Your profile discount: complimentary stay · You save ${saving}. No payment or security deposit required.`;
  if (rule?.discountType === 'percentage') return `Your profile discount: ${rule.percentage}% off · You save ${saving}. Already applied.`;
  if (rule?.discountType === 'amount') return `Your profile discount: ${money(rule.amountOffCents)} off · You save ${saving}. Already applied.`;
  if (rule?.discountType === 'flat') return `Your saved whole-stay rate: ${money(quote.discountedStayCents)} before any required fees and taxes · You save ${saving}. Already applied.`;
  if (quote.automaticPromotion) return `${quote.automaticPromotion.label}: ${quote.automaticPromotion.percentage}% off · You save ${saving}. Already applied.`;
  return 'Your stay is priced at the current available rate.';
}
