const PREFERRED_FIRST_NAMES = new Map([
  ['abigail', 'Abby'],
]);

export function guestFirstName(fullName) {
  const firstName = String(fullName || '').trim().split(/\s+/)[0] || 'Guest';
  return PREFERRED_FIRST_NAMES.get(firstName.toLocaleLowerCase('en-US')) || firstName;
}
