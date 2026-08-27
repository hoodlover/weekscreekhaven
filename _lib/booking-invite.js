function normalized(value) {
  return String(value || '').trim().toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
}

function bookingDates(booking) {
  return (booking?.dateChoices || []).filter((choice) => choice?.arrival && choice?.departure);
}

function inviteDates(invite) {
  return (invite?.stayOptions || []).filter((choice) => choice?.arrival && choice?.departure);
}

function datesMatch(booking, invite) {
  const bookings = bookingDates(booking);
  const invites = inviteDates(invite);
  return bookings.some((bookingChoice) => invites.some((inviteChoice) => bookingChoice.arrival === inviteChoice.arrival && bookingChoice.departure === inviteChoice.departure));
}

function identityMatches(booking, invite) {
  const sameEmail = normalized(booking?.email) && normalized(booking.email) === normalized(invite?.recipientEmail);
  const sameName = normalized(booking?.name) && normalized(booking.name) === normalized(invite?.label);
  return { sameEmail, sameName };
}

export function findBookingInvite(booking, invites = []) {
  if (!booking) return null;
  const direct = booking.inviteId ? invites.find((invite) => invite.id === booking.inviteId) : null;
  if (direct) return direct;
  const reverse = invites.find((invite) => invite.bookingId === booking.id);
  if (reverse) return reverse;

  const candidates = invites.filter((invite) => {
    const identity = identityMatches(booking, invite);
    return identity.sameEmail || identity.sameName;
  });
  const dateMatched = candidates.filter((invite) => datesMatch(booking, invite));
  if (dateMatched.length === 1) return dateMatched[0];

  const active = candidates.filter((invite) => !invite.revokedAt);
  const emailMatched = active.filter((invite) => identityMatches(booking, invite).sameEmail);
  if (emailMatched.length === 1) return emailMatched[0];
  const nameMatched = active.filter((invite) => identityMatches(booking, invite).sameName);
  return nameMatched.length === 1 ? nameMatched[0] : null;
}

export function findInviteBooking(invite, bookings = []) {
  if (!invite) return null;
  const direct = invite.bookingId ? bookings.find((booking) => booking.id === invite.bookingId) : null;
  if (direct) return direct;
  const reverse = bookings.find((booking) => booking.inviteId === invite.id);
  if (reverse) return reverse;
  const candidates = bookings.filter((booking) => {
    const identity = identityMatches(booking, invite);
    return identity.sameEmail || identity.sameName;
  });
  const dateMatched = candidates.filter((booking) => datesMatch(booking, invite));
  if (dateMatched.length === 1) return dateMatched[0];
  const emailMatched = candidates.filter((booking) => identityMatches(booking, invite).sameEmail);
  if (emailMatched.length === 1) return emailMatched[0];
  const nameMatched = candidates.filter((booking) => identityMatches(booking, invite).sameName);
  return nameMatched.length === 1 ? nameMatched[0] : null;
}
