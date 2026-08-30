import { appendInviteRecord, getAccessRecords, getInvites } from '../_lib/invite-store.js';
import { appendBookingRecord, getBookingCalendar, rangesOverlap, unavailableRanges } from '../_lib/booking-store.js';
import { generatePasscode, hashPasscode, json, requireAdmin } from '../_lib/security.js';
import { findInviteBooking } from '../_lib/booking-invite.js';

function safeText(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function safeEmail(value) {
  const email = safeText(value, 160).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function safePhone(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return digits.length === 10 ? digits : '';
}

function safeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
}

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function nights(option) {
  return Math.round((Date.parse(`${option.departure}T00:00:00Z`) - Date.parse(`${option.arrival}T00:00:00Z`)) / 86400000);
}

function presentInvite(invite, booking = null) {
  const { hash: _hash, salt: _salt, ...safeInvite } = invite;
  return {
    ...safeInvite,
    selectedStayChoice: booking && ['reserved', 'booked'].includes(booking.status) ? booking.approvedChoice : null,
    stayStatus: booking?.status || null,
    photos: (safeInvite.photos || []).map(({ id, createdAt }) => ({ id, createdAt })),
  };
}

function stayOptions(body) {
  const supplied = Array.isArray(body?.stayOptions) ? body.stayOptions.slice(0, 3) : [];
  const legacy = body?.stayArrival || body?.stayDeparture || body?.stayCost ? [{ arrival: body.stayArrival, departure: body.stayDeparture, cost: body.stayCost }] : [];
  return (supplied.length ? supplied : legacy).filter((option) => option?.arrival || option?.departure || String(option?.cost || '').trim()).map((option) => {
    const arrival = safeDate(option.arrival);
    const departure = safeDate(option.departure);
    const complimentary = option.complimentary === true;
    const suppliedCost = complimentary ? '' : String(option.cost || '').trim();
    const costCents = suppliedCost ? Math.round(Number(suppliedCost) * 100) : 0;
    return { arrival, departure, costCents, suppliedCost, complimentary, expiresOn: safeDate(option.expiresOn) || null };
  });
}

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') {
      const [invites, access, calendar] = await Promise.all([getInvites(), getAccessRecords(), getBookingCalendar()]);
      const withActivity = invites.map((invite) => {
        const inviteAccess = access.filter((entry) => entry.inviteId === invite.id);
        const booking = findInviteBooking(invite, calendar.bookings);
        return { ...presentInvite(invite, booking), accessCount: inviteAccess.length, lastAccessAt: inviteAccess[0]?.accessedAt || null };
      });
      return json(response, 200, { invites: withActivity, access: access.slice(0, 250) }, { 'Cache-Control': 'no-store' });
    }

    if (request.method === 'POST') {
      const label = safeText(request.body?.label, 80);
      if (label.length < 2) return json(response, 400, { error: 'Add the friend or family name for this invite.' });
      const suppliedPhone = safeText(request.body?.recipientPhone, 40);
      const recipientPhone = safePhone(suppliedPhone);
      if (suppliedPhone && !recipientPhone) return json(response, 400, { error: 'Enter a complete 10-digit guest phone number or leave it blank.' });
      const passcode = generatePasscode();
      const passcodeHash = hashPasscode(passcode);
      const createdAt = new Date().toISOString();
      const expiresAt = request.body?.expiresAt ? new Date(request.body.expiresAt).toISOString() : null;
      const options = stayOptions(request.body);
      for (const option of options) {
        if (!option.arrival || !option.departure || option.departure <= option.arrival) return json(response, 400, { error: 'Complete both dates for every stay option, or remove the incomplete option.' });
        if (nights(option) < 1) return json(response, 400, { error: 'Every offered stay must include at least one night.' });
        if (option.suppliedCost && (!Number.isInteger(option.costCents) || option.costCents < 0)) return json(response, 400, { error: 'Enter a valid optional cost for every stay option.' });
        if (option.expiresOn && (option.expiresOn < easternToday() || option.expiresOn > option.arrival)) return json(response, 400, { error: 'Each choose-by date must be between today and that stay’s arrival.' });
      }
      for (let first = 0; first < options.length; first++) for (let second = first + 1; second < options.length; second++) {
        if (rangesOverlap(options[first], options[second])) return json(response, 400, { error: 'The offered stay options cannot overlap each other.' });
      }
      if (options.length) {
        const conflicts = unavailableRanges(await getBookingCalendar());
        if (options.some((option) => conflicts.some((range) => rangesOverlap(option, range)))) return json(response, 409, { error: 'At least one offered stay overlaps dates that are already reserved or blocked.' });
      }
      const inviteId = crypto.randomUUID();
      const bookingId = options.length ? crypto.randomUUID() : null;
      const invite = {
        id: inviteId, label, passcode, ...passcodeHash, createdAt, expiresAt,
        notes: safeText(request.body?.notes, 240),
        recipientEmail: safeEmail(request.body?.recipientEmail),
        recipientPhone,
        welcomeMessage: safeText(request.body?.welcomeMessage, 500),
        complimentary: request.body?.complimentary === true,
        stayOptions: options.map(({ arrival, departure, costCents, complimentary, expiresOn }) => ({ arrival, departure, costCents, complimentary, expiresOn })),
        bookingId,
        photos: [],
        maxUses: Math.max(0, Math.min(999, Number(request.body?.maxUses) || 0)),
      };
      if (options.length) {
        const booking = {
          id: bookingId, inviteId, source: 'direct-invite', status: 'offered', createdAt,
          name: label, email: invite.recipientEmail, phone: invite.recipientPhone, guests: 1,
          dateChoices: options.map(({ arrival, departure, costCents, complimentary, expiresOn }) => ({ arrival, departure, amountCents: complimentary ? 0 : (costCents || undefined), complimentary, expiresOn })),
          notes: invite.notes,
        };
        await appendBookingRecord({ type: 'requested', createdAt, booking });
      }
      try {
        await appendInviteRecord({ type: 'created', createdAt, invite });
      } catch (error) {
        if (bookingId) await appendBookingRecord({ type: 'status', bookingId, changes: { status: 'cancelled', cancelledAt: new Date().toISOString() }, createdAt: new Date().toISOString() }).catch(() => {});
        throw error;
      }
      return json(response, 201, { invite: presentInvite(invite, options.length ? { status: 'offered' } : null) });
    }

    if (request.method === 'PATCH') {
      const inviteId = safeText(request.body?.inviteId, 80);
      const [invites, calendar] = await Promise.all([getInvites(), getBookingCalendar()]);
      const invite = invites.find((item) => item.id === inviteId);
      if (!invite) return json(response, 404, { error: 'Invite not found.' });
      const createdAt = new Date().toISOString();
      await appendInviteRecord({ type: 'revoked', createdAt, inviteId });
      const booking = invite.bookingId ? calendar.bookings.find((item) => item.id === invite.bookingId) : null;
      if (booking?.status === 'offered') await appendBookingRecord({ type: 'status', bookingId: booking.id, changes: { status: 'cancelled', cancelledAt: createdAt }, createdAt });
      return json(response, 200, { ok: true, releasedOffers: booking?.status === 'offered' });
    }

    return json(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Invite storage is unavailable. Check the site storage settings.' });
  }
}
