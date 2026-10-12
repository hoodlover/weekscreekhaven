// Shared contact matching; names personalize greetings but never select private pricing.
export function guestFirstName(value) {
  const first = String(value || '').trim().split(/\s+/)[0].slice(0, 60);
  return first.toLowerCase() === 'abigail' ? 'Abby' : first;
}

export function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const phone = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return phone.length === 10 ? phone : '';
}

export function normalizedEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export const discountPhone = (rule) => normalizedPhone(rule.matchType === 'phone' ? rule.target : rule.phone);
export const discountEmail = (rule) => normalizedEmail(rule.email || (rule.matchType === 'email' ? rule.target : ''));

export function matchingGuestDiscount(identity, discounts = []) {
  const input = typeof identity === 'object' && identity ? identity : { phone: identity };
  const phone = normalizedPhone(input.phone), email = normalizedEmail(input.email);
  const matches = discounts.filter((rule) => (phone && discountPhone(rule) === phone) || (email && discountEmail(rule) === email));
  if (matches.length > 1) throw Object.assign(new Error('The email and phone match different saved rates. Check your contact details or contact Lance and Heather.'), { status: 409 });
  return matches[0] || null;
}
