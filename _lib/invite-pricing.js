import { withEstimatedTaxesAndFees } from '../pricing.js';

export function applyInviteComplimentary(quote, invite) {
  if (!quote || invite?.complimentary !== true) return quote;
  const standardTotalCents = Math.max(0, Number(quote.standardTotalCents ?? quote.totalCents) || 0);
  return withEstimatedTaxesAndFees({
    ...quote,
    standardTotalCents,
    earlyBirdDiscount: null,
    earlyBirdDiscountCents: 0,
    automaticPromotion: null,
    discountAmountCents: standardTotalCents,
    discountCents: standardTotalCents,
    totalCents: 0,
    complimentary: true,
    discountedStayCents: 0,
    passThroughCents: 0,
    passThroughFees: {
      cleaningFeeCents: 0,
      dogFeeCents: 0,
      lateCheckoutFeeCents: 0,
      customFeeCents: 0,
      customFeeLabel: '',
    },
    friendsAndFamilyDiscount: {
      id: `invite-${invite.id || 'complimentary'}`,
      guestName: String(invite.label || ''),
      label: 'Complimentary stay',
      discountType: 'complimentary',
      percentage: null,
      amountOffCents: null,
      flatTotalCents: null,
    },
  });
}
