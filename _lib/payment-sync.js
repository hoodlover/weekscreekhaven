import { appendBookingRecord, getBookingCalendar, rangesOverlap, unavailableRanges } from './booking-store.js';
import { finalizeBookingFlow } from './booking-finalization.js';
import { getSquareInvoice } from './square.js';

function paidCents(invoice) {
  return (invoice?.payment_requests || []).reduce((sum, request) => (
    sum + (Number(request.total_completed_amount_money?.amount) || 0)
  ), 0);
}

function invoiceTotalCents(invoice) {
  return (invoice?.payment_requests || []).reduce((sum, request) => (
    sum + (Number(request.computed_amount_money?.amount) || 0)
  ), 0);
}

function requiredCents(booking) {
  if (booking.paymentPlan === 'complimentary') return 0;
  if (['deposit-balance','friends-family-deposit'].includes(booking.paymentPlan)) return Number(booking.depositAmountCents) || 10000;
  return Number(booking.amountCents) || 0;
}

export function squarePaymentChanges(booking, invoice, checkedAt = new Date().toISOString()) {
  const squarePaidCents = paidCents(invoice);
  const squareInvoiceTotalCents = invoiceTotalCents(invoice) || Number(booking.amountCents) || 0;
  const paymentRequirementCents = requiredCents(booking);
  const paymentFullyPaid = invoice?.status === 'PAID';
  const paymentRequirementMet = paymentFullyPaid || squarePaidCents >= paymentRequirementCents;
  const changes = {
    squareInvoiceStatus: String(invoice?.status || 'UNKNOWN'),
    squarePaidCents,
    squareInvoiceTotalCents,
    squareBalanceCents: Math.max(0, squareInvoiceTotalCents - squarePaidCents),
    paymentRequirementCents,
    paymentRequirementMet,
    paymentFullyPaid,
    paymentCheckedAt: checkedAt,
  };
  if (paymentRequirementMet) changes.paymentReceivedAt = booking.paymentReceivedAt || invoice?.updated_at || checkedAt;
  if (paymentRequirementMet && booking.agreementAcceptedAt && booking.status === 'reserved') {
    changes.status = 'booked';
    changes.bookedAt = booking.bookedAt || checkedAt;
    changes.bookedAutomatically = true;
  }
  return changes;
}

function changed(booking, changes, includeCheckTime) {
  return Object.entries(changes).some(([key, value]) => {
    if (key === 'paymentCheckedAt' && !includeCheckTime) return false;
    return booking[key] !== value;
  });
}

export async function applySquareInvoice(booking, invoice, { eventId = '', recordCheck = false } = {}) {
  const checkedAt = new Date().toISOString();
  const changes = squarePaymentChanges(booking, invoice, checkedAt);
  if (changes.paymentRequirementMet && booking.status === 'pending-payment') {
    const dates=booking.dateChoices?.[Number.isInteger(booking.approvedChoice)?booking.approvedChoice:0]||booking.dateChoices?.[0];
    const conflicts=unavailableRanges(await getBookingCalendar()).filter(range=>range.bookingId!==booking.id);
    if (dates&&conflicts.some(range=>rangesOverlap(dates,range))) {
      changes.status='payment-conflict';
      changes.paymentConflictAt=checkedAt;
      changes.paymentConflictReason='Another guest completed the deposit first. Owner refund or alternate dates required.';
    } else {
      changes.status=booking.agreementAcceptedAt?'booked':'reserved';
      changes.reservedAt=checkedAt;
      if(booking.agreementAcceptedAt){changes.bookedAt=booking.bookedAt||checkedAt;changes.bookedAutomatically=true;}
    }
  }
  if (eventId) changes.squareLastEventId = eventId;
  if (changed(booking, changes, recordCheck || Boolean(eventId))) {
    await appendBookingRecord({ type: 'status', bookingId: booking.id, changes, createdAt: checkedAt });
  }
  return finalizeBookingFlow({ ...booking, ...changes });
}

export async function refreshSquareBooking(booking, options = {}) {
  if (!booking?.squareInvoiceId) return booking;
  const invoice = await getSquareInvoice(booking.squareInvoiceId);
  return applySquareInvoice(booking, invoice, options);
}
