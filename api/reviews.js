import { appendBookingRecord, getBookingRequests } from '../_lib/booking-store.js';
import { appendReview, getReviews } from '../_lib/review-store.js';
import { json, verifyReviewToken } from '../_lib/security.js';

function safeText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function rating(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : 0;
}

async function reviewContext(rawToken) {
  const token = verifyReviewToken(rawToken);
  if (!token) return null;
  const booking = (await getBookingRequests()).find((item) => item.id === token.bookingId);
  if (!booking) return null;
  const dates = booking.dateChoices?.[Number.isInteger(booking.approvedChoice) ? booking.approvedChoice : 0] || booking.dateChoices?.[0] || null;
  const existing = (await getReviews()).find((review) => review.bookingId === booking.id);
  return { booking, dates, existing };
}

export default async function handler(request, response) {
  try {
    const rawToken = request.method === 'GET' ? request.query?.token : request.body?.token;
    const context = await reviewContext(rawToken);
    if (!context) return json(response, 404, { error: 'This review link is invalid or has expired.' });
    if (request.method === 'GET') {
      return json(response, 200, {
        guestName: context.booking.name,
        dates: context.dates,
        submitted: Boolean(context.existing),
      }, { 'Cache-Control': 'no-store' });
    }
    if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
    if (context.existing) return json(response, 409, { error: 'Thank you — a review has already been submitted from this link.' });

    const overall = rating(request.body?.overall);
    if (!overall) return json(response, 400, { error: 'Choose an overall star rating.' });
    const review = {
      id: crypto.randomUUID(),
      bookingId: context.booking.id,
      guestName: context.booking.name,
      displayName: safeText(request.body?.displayName || context.booking.name, 80),
      overall,
      cleanliness: rating(request.body?.cleanliness),
      comfort: rating(request.body?.comfort),
      location: rating(request.body?.location),
      communication: rating(request.body?.communication),
      recommend: request.body?.recommend === true,
      publicComments: safeText(request.body?.publicComments, 1500),
      privateComments: safeText(request.body?.privateComments, 1500),
      allowTestimonial: request.body?.allowTestimonial === true,
      createdAt: new Date().toISOString(),
    };
    if (!review.publicComments && !review.privateComments) return json(response, 400, { error: 'Add a short note about the stay.' });
    await appendReview(review);
    await appendBookingRecord({ type: 'status', bookingId: context.booking.id, changes: { reviewSubmittedAt: review.createdAt, reviewRating: overall }, createdAt: review.createdAt });
    return json(response, 201, { ok: true });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'Your review could not be saved.' });
  }
}
