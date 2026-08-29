export const PRICING_CONFIG = Object.freeze({
  currency: 'USD',
  maxGuests: 11,
  roundToCents: 500,
  includedCleaningCents: 20000,
  lateCheckoutCents: 5000,
  salesTaxRate: 0.07,
  lodgingTaxRate: 0.06,
  stateHotelMotelFeePerNightCents: 500,
  refundableSecurityDepositCents: 30000,
  cleaningTiers: Object.freeze([
    Object.freeze({ minGuests: 1, maxGuests: 4, amountCents: 20000 }),
    Object.freeze({ minGuests: 5, maxGuests: 8, amountCents: 22500 }),
    Object.freeze({ minGuests: 9, maxGuests: 11, amountCents: 25000 }),
  ]),
  seasons: Object.freeze([
    Object.freeze({ id: 'winter', label: 'January–March', weekendCents: 52500 }),
    Object.freeze({ id: 'spring-summer', label: 'April–August', weekendCents: 60000 }),
    Object.freeze({ id: 'early-september', label: 'Early September', weekendCents: 62500 }),
    Object.freeze({ id: 'late-september', label: 'Late September', weekendCents: 75000 }),
    Object.freeze({ id: 'october', label: 'October leaf season', weekendCents: 90000 }),
    Object.freeze({ id: 'november', label: 'November', weekendCents: 67500 }),
    Object.freeze({ id: 'december', label: 'December', weekendCents: 65000 }),
    Object.freeze({ id: 'thanksgiving', label: 'Thanksgiving', weekendCents: 95000 }),
    Object.freeze({ id: 'christmas-new-year', label: 'Christmas & New Year', weekendCents: 97500 }),
  ]),
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validDate(value) {
  return DATE_PATTERN.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T12:00:00`));
}

export function addDays(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function daysBetween(arrival, departure) {
  return Math.round((Date.parse(`${departure}T00:00:00Z`) - Date.parse(`${arrival}T00:00:00Z`)) / 86400000);
}

export function roundUpCents(amountCents, incrementCents = PRICING_CONFIG.roundToCents) {
  return Math.ceil(Number(amountCents || 0) / incrementCents) * incrementCents;
}

export function money(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: PRICING_CONFIG.currency, maximumFractionDigits: 0 }).format(Number(cents || 0) / 100);
}

function fourthThursday(year) {
  const first = new Date(`${year}-11-01T12:00:00`);
  const firstThursday = 1 + ((4 - first.getDay() + 7) % 7);
  return `${year}-11-${String(firstThursday + 21).padStart(2, '0')}`;
}

function holidaySeason(dateKey) {
  const year = Number(dateKey.slice(0, 4));
  const thanksgiving = fourthThursday(year);
  if (dateKey >= addDays(thanksgiving, -1) && dateKey <= addDays(thanksgiving, 3)) return PRICING_CONFIG.seasons.find((season) => season.id === 'thanksgiving');
  if (dateKey >= `${year}-12-20` || dateKey <= `${year}-01-03`) return PRICING_CONFIG.seasons.find((season) => season.id === 'christmas-new-year');
  return null;
}

export function seasonForDate(dateKey) {
  const holiday = holidaySeason(dateKey);
  if (holiday) return holiday;
  const month = Number(dateKey.slice(5, 7));
  const day = Number(dateKey.slice(8, 10));
  if (month <= 3) return PRICING_CONFIG.seasons.find((season) => season.id === 'winter');
  if (month <= 8) return PRICING_CONFIG.seasons.find((season) => season.id === 'spring-summer');
  if (month === 9) return PRICING_CONFIG.seasons.find((season) => season.id === (day <= 15 ? 'early-september' : 'late-september'));
  if (month === 10) return PRICING_CONFIG.seasons.find((season) => season.id === 'october');
  if (month === 11) return PRICING_CONFIG.seasons.find((season) => season.id === 'november');
  return PRICING_CONFIG.seasons.find((season) => season.id === 'december');
}

export function fridayForCalendarWeek(dateKey) {
  const day = new Date(`${dateKey}T12:00:00`).getDay();
  return addDays(dateKey, day === 6 ? -1 : 5 - day);
}

function customWeekendRate(friday, rates = []) {
  return rates.filter((rate) => rate.pricingMode === 'total' && rate.arrival === friday && rate.departure >= addDays(friday, 2)).at(-1) || null;
}

function customNightlyRate(dateKey, rates = []) {
  return rates.filter((rate) => rate.pricingMode !== 'total' && dateKey >= rate.arrival && dateKey < rate.departure).at(-1) || null;
}

export function weekPlan(dateKey, rates = []) {
  const friday = fridayForCalendarWeek(dateKey);
  const weekendOverride = customWeekendRate(friday, rates);
  const season = seasonForDate(friday);
  const weekendCents = Number(weekendOverride?.totalCents) || (weekendOverride ? Number(weekendOverride.amountCents || 0) * Number(weekendOverride.nightCount || daysBetween(weekendOverride.arrival, weekendOverride.departure)) : season.weekendCents);
  const derivedWeeknightCents = roundUpCents(weekendCents * 0.4);
  const nightlyOverride = weekendOverride ? null : customNightlyRate(dateKey, rates);
  const weeknightCents = Number(nightlyOverride?.amountCents) || derivedWeeknightCents;
  return {
    friday,
    seasonId: weekendOverride ? 'owner-override' : season.id,
    seasonLabel: weekendOverride ? 'Owner-set weekend' : season.label,
    weekendCents,
    weeknightCents,
    twoNightCents: roundUpCents(weeknightCents * 2),
    fiveNightFromCents: roundUpCents(weeknightCents * 5),
    weeklyCents: roundUpCents(weeknightCents * 7),
    ownerOverride: Boolean(weekendOverride),
  };
}

export function cleaningFeeForGuests(guests) {
  const count = Math.max(1, Math.min(PRICING_CONFIG.maxGuests, Number(guests) || 1));
  return PRICING_CONFIG.cleaningTiers.find((tier) => count >= tier.minGuests && count <= tier.maxGuests)?.amountCents || 0;
}

export function withEstimatedTaxesAndFees(quote) {
  const taxableSubtotalCents = Math.max(0, Number(quote?.totalCents) || 0);
  const complimentary = Boolean(quote?.complimentary) && taxableSubtotalCents === 0;
  const salesTaxCents = complimentary ? 0 : Math.round(taxableSubtotalCents * PRICING_CONFIG.salesTaxRate);
  const lodgingTaxCents = complimentary ? 0 : Math.round(taxableSubtotalCents * PRICING_CONFIG.lodgingTaxRate);
  const stateHotelMotelFeeCents = complimentary ? 0 : Math.max(0, Number(quote?.actualNights) || 0) * PRICING_CONFIG.stateHotelMotelFeePerNightCents;
  const estimatedTaxesAndFeesCents = salesTaxCents + lodgingTaxCents + stateHotelMotelFeeCents;
  const refundableSecurityDepositCents = complimentary ? 0 : PRICING_CONFIG.refundableSecurityDepositCents;
  const estimatedGrandTotalCents = taxableSubtotalCents + estimatedTaxesAndFeesCents;
  const estimatedAmountDueCents = estimatedGrandTotalCents + refundableSecurityDepositCents;
  return {
    ...quote,
    taxableSubtotalCents,
    salesTaxCents,
    lodgingTaxCents,
    stateHotelMotelFeeCents,
    estimatedTaxesAndFeesCents,
    refundableSecurityDepositCents,
    estimatedGrandTotalCents,
    estimatedAmountDueCents,
  };
}

function exactOwnerTotal(arrival, departure, rates = []) {
  return rates.filter((rate) => rate.pricingMode === 'total' && rate.arrival === arrival && rate.departure === departure).at(-1) || null;
}

export function quoteStay({ arrival, departure, guests = 1, dogs = 0, rates = [], lateCheckout = false, pricingDate = new Date().toISOString().slice(0, 10) }) {
  if (!validDate(arrival) || !validDate(departure) || departure <= arrival) return null;
  const actualNights = daysBetween(arrival, departure);
  if (actualNights < 1) return null;
  const guestCount = Math.max(1, Math.min(PRICING_CONFIG.maxGuests, Number(guests) || 1));
  const dogCount = Math.max(0, Math.min(4, Number(dogs) || 0));
  const exactTotal = exactOwnerTotal(arrival, departure, rates);
  let lodgingCents = 0;
  let pricingRule = 'Standard nightly mix';
  let minimumApplied = false;
  const nightly = [];

  if (exactTotal) {
    lodgingCents = Number(exactTotal.totalCents) || Number(exactTotal.amountCents || 0) * Number(exactTotal.nightCount || actualNights);
    pricingRule = 'Owner-set stay total';
  } else if (actualNights === 1) {
    const plan = weekPlan(arrival, rates);
    const day = new Date(`${arrival}T12:00:00`).getDay();
    lodgingCents = day === 5 || day === 6 ? plan.weekendCents : plan.twoNightCents;
    pricingRule = 'One night · two-night minimum price';
    minimumApplied = true;
  } else if (actualNights >= 7) {
    for (let index = 0; index < actualNights; index++) {
      const date = addDays(arrival, index);
      const amountCents = weekPlan(date, rates).weeknightCents;
      nightly.push({ date, amountCents, kind: 'weekly-rate' });
      lodgingCents += amountCents;
    }
    pricingRule = actualNights === 7 ? 'Weekly price · weekday rate throughout' : 'Extended stay · weekday rate throughout';
  } else {
    const chargedWeekends = new Set();
    for (let index = 0; index < actualNights; index++) {
      const date = addDays(arrival, index);
      const day = new Date(`${date}T12:00:00`).getDay();
      let amountCents;
      let kind;
      if ([5, 6].includes(day)) {
        const friday = fridayForCalendarWeek(date);
        const alreadyCharged = chargedWeekends.has(friday);
        amountCents = alreadyCharged ? 0 : weekPlan(date, rates).weekendCents;
        kind = alreadyCharged ? 'weekend-included' : 'weekend-package';
        chargedWeekends.add(friday);
      } else {
        amountCents = weekPlan(date, rates).weeknightCents;
        kind = 'weeknight';
      }
      nightly.push({ date, amountCents, kind });
      lodgingCents += amountCents;
    }
    pricingRule = chargedWeekends.size
      ? `${actualNights === 5 ? 'Five-night price' : 'Stay price'} · full weekend package${chargedWeekends.size > 1 ? 's' : ''} + weeknights`
      : actualNights === 5 ? 'Five-night price · included dates' : 'Night-by-night price';
  }

  lodgingCents = roundUpCents(lodgingCents);
  const cleaningCents = cleaningFeeForGuests(guestCount);
  const cleaningAdjustmentCents = Math.max(0, cleaningCents - PRICING_CONFIG.includedCleaningCents);
  const lateCheckoutSelected = lateCheckout === true || lateCheckout === 'true' || lateCheckout === 'on' || lateCheckout === 1 || lateCheckout === '1';
  const lateCheckoutCents = lateCheckoutSelected ? PRICING_CONFIG.lateCheckoutCents : 0;
  const standardTotalCents = lodgingCents + cleaningAdjustmentCents + lateCheckoutCents;
  const leadDays = Math.floor((Date.parse(`${arrival}T12:00:00Z`) - Date.parse(`${pricingDate}T12:00:00Z`)) / 86400000);
  const earlyBirdPercentage = leadDays >= 90 ? 15 : leadDays >= 60 ? 10 : leadDays >= 30 ? 5 : 0;
  const allMidweek=Array.from({length:actualNights},(_,index)=>new Date(`${addDays(arrival,index)}T12:00:00Z`).getUTCDay()).every(day=>day!==5&&day!==6);
  const allOffSeason=Array.from({length:actualNights},(_,index)=>addDays(arrival,index)).every((date)=>Number(date.slice(5,7))<=3);
  const promotions=[
    {id:'book-direct',label:'Automatic Book Direct',percentage:10},
    ...(earlyBirdPercentage?[{id:'early-bird',label:'Automatic Early Bird',percentage:earlyBirdPercentage}]:[]),
    ...(allMidweek?[{id:'midweek',label:'Automatic Midweek Stay',percentage:20}]:[]),
    ...(actualNights>=4?[{id:'extended',label:'Automatic Extended Stay',percentage:actualNights>=7?20:10}]:[]),
    ...(leadDays>=0&&leadDays<=7?[{id:'last-minute',label:'Automatic Last-minute Opening',percentage:15}]:[]),
    ...(allOffSeason?[{id:'off-season',label:'Automatic Off-season Stay',percentage:20}]:[]),
  ];
  const bestPromotion=promotions.sort((a,b)=>b.percentage-a.percentage)[0];
  const promotionDiscountCents=Math.round(standardTotalCents*bestPromotion.percentage/100);
  const earlyBirdDiscountCents=bestPromotion.id==='early-bird'?promotionDiscountCents:0;
  return withEstimatedTaxesAndFees({
    arrival,
    departure,
    guests: guestCount,
    dogs: dogCount,
    actualNights,
    billedNights: Math.max(2, actualNights),
    minimumApplied,
    pricingRule,
    baseStayCents: lodgingCents,
    lodgingCents,
    cleaningCents,
    includedCleaningCents: PRICING_CONFIG.includedCleaningCents,
    cleaningAdjustmentCents,
    checkInTime: '4:00 PM',
    checkoutTime: lateCheckoutSelected ? 'noon' : '11:00 AM',
    lateCheckout: lateCheckoutSelected,
    lateCheckoutCents,
    standardTotalCents,
    discountAmountCents: promotionDiscountCents,
    discountCents: promotionDiscountCents,
    automaticPromotion: bestPromotion,
    earlyBirdDiscountCents,
    earlyBirdDiscount: earlyBirdPercentage ? { percentage: earlyBirdPercentage, leadDays, label: `Automatic Early Bird · ${earlyBirdPercentage}% off` } : null,
    totalCents: standardTotalCents - promotionDiscountCents,
    nightly,
  });
}

function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function matchingDiscount(phone, discounts = []) {
  const target = normalizedPhone(phone);
  if (target.length !== 10) return null;
  return discounts.find((rule) => rule.matchType === 'phone' && rule.target === target) || null;
}

export function applyFriendsAndFamilyDiscount(quote, phone, discounts = []) {
  if (!quote) return null;
  const rule = matchingDiscount(phone, discounts);
  if (!rule) return quote;
  const noChargeStay = rule.discountType === 'complimentary';
  const cleaningFeeCents = !noChargeStay && rule.chargeCleaning ? 17500 : 0;
  const dogFeeCents = !noChargeStay && rule.chargeDogFee ? quote.dogs * Math.ceil(quote.actualNights / 2) * 2500 : 0;
  const lateCheckoutFeeCents = !noChargeStay && rule.chargeLateCheckout ? quote.lateCheckoutCents : 0;
  const customFeeCents = noChargeStay ? 0 : Math.max(0, Number(rule.customFeeCents) || 0);
  const publicTotalCents = Number(quote.standardTotalCents ?? quote.totalCents);
  const removedCleaningCents = rule.chargeCleaning ? Math.min(publicTotalCents, quote.includedCleaningCents + quote.cleaningAdjustmentCents) : 0;
  const removedLateCheckoutCents = rule.chargeLateCheckout ? quote.lateCheckoutCents : 0;
  const discountableCents = Math.max(0, publicTotalCents - removedCleaningCents - removedLateCheckoutCents);
  let discountedStayCents = discountableCents;
  if (noChargeStay) {
    discountedStayCents = 0;
  } else if (rule.discountType === 'percentage') {
    const percentage = Math.max(0, Math.min(100, Number(rule.percentage) || 0));
    discountedStayCents = percentage >= 100 ? 0 : roundUpCents(discountableCents * (1 - percentage / 100));
  } else if (rule.discountType === 'amount') {
    discountedStayCents = Math.max(0, discountableCents - Math.max(0, Number(rule.amountOffCents) || 0));
  } else if (rule.discountType === 'flat') {
    discountedStayCents = Math.min(discountableCents, roundUpCents(Math.max(0, Number(rule.flatTotalCents) || 0)));
  }
  const passThroughCents = cleaningFeeCents + dogFeeCents + lateCheckoutFeeCents + customFeeCents;
  const standardTotalCents = publicTotalCents + dogFeeCents + customFeeCents;
  const discountedTotalCents = discountedStayCents + passThroughCents;
  const discountAmountCents = Math.max(0, standardTotalCents - discountedTotalCents);
  return withEstimatedTaxesAndFees({
    ...quote,
    standardTotalCents,
    earlyBirdDiscount: null,
    earlyBirdDiscountCents: 0,
    automaticPromotion: null,
    discountAmountCents,
    discountCents: discountAmountCents,
    totalCents: discountedTotalCents,
    complimentary: noChargeStay && discountedTotalCents === 0,
    discountedStayCents,
    passThroughCents,
    passThroughFees: {
      cleaningFeeCents,
      dogFeeCents,
      lateCheckoutFeeCents,
      customFeeCents,
      customFeeLabel: String(rule.customFeeLabel || 'Required fee'),
    },
    friendsAndFamilyDiscount: {
      id: rule.id,
      guestName: String(rule.guestName || ''),
      label: String(rule.label || 'Friends & Family rate'),
      discountType: rule.discountType,
      percentage: rule.discountType === 'percentage' ? Number(rule.percentage) : null,
      amountOffCents: rule.discountType === 'amount' ? Number(rule.amountOffCents) : null,
      flatTotalCents: rule.discountType === 'flat' ? Number(rule.flatTotalCents) : null,
    },
  });
}

export function quoteSummary(quote) {
  if (!quote) return '';
  const adjustment = quote.cleaningAdjustmentCents ? ` + ${money(quote.cleaningAdjustmentCents)} large-group cleaning` : '';
  const lateCheckout = quote.lateCheckoutCents ? ` + ${money(quote.lateCheckoutCents)} noon checkout` : '';
  return `${quote.actualNights} night${quote.actualNights === 1 ? '' : 's'} · ${money(quote.baseStayCents)} base stay${adjustment}${lateCheckout} · ${money(quote.totalCents)} estimated price · does not include ${money(quote.estimatedTaxesAndFeesCents)} in taxes and fees`;
}
