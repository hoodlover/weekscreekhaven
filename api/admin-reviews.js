import { appendBookingRecord, getBookingRequests } from '../_lib/booking-store.js';
import { sendEmail } from '../_lib/email.js';
import { currentReviewVersions, getReviews } from '../_lib/review-store.js';
import { combinedReviews } from '../_lib/legacy-reviews.js';
import { createReviewToken, json, requireAdmin } from '../_lib/security.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    const bookings = await getBookingRequests();
    if (request.method === 'GET') {
      const bookingsById = new Map(bookings.map((booking) => [booking.id, booking]));
      const reviews = currentReviewVersions(await getReviews()).map((review) => ({
        ...review,
        reviewUpdateExpiresAt: bookingsById.get(review.bookingId)?.reviewEditExpiresAt || '',
      }));
      return json(response, 200, { reviews: combinedReviews(reviews) }, { 'Cache-Control': 'no-store' });
    }
    if (request.method !== 'PATCH') return json(response, 405, { error: 'Method not allowed.' });
    if (request.body?.action !== 'allow-review-update') return json(response, 400, { error: 'Choose a valid review action.' });
    const review = (await getReviews()).find((item) => item.id === String(request.body?.reviewId || ''));
    if (!review?.bookingId) return json(response, 404, { error: 'The guest booking for this review could not be found.' });
    const booking = bookings.find((item) => item.id === review.bookingId);
    if (!booking?.email) return json(response, 400, { error: 'This booking does not have a guest email address.' });
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    const reviewUrl = `https://www.weekscreekhaven.com/review.html?token=${encodeURIComponent(createReviewToken(booking.id, 7 * 86400))}`;
    await appendBookingRecord({ type:'status', bookingId:booking.id, changes:{ reviewEditAllowedAt:createdAt, reviewEditExpiresAt:expiresAt, reviewUpdateEmailSentAt:createdAt }, createdAt });
    await sendEmail({
      to:booking.email, toName:booking.name, templateKey:'review-update-invitation', templateVariables:{ guestName:booking.name, reviewUrl },
      subject:'You’re welcome to update your Weeks Creek Haven review',
      text:`Hi ${booking.name},\n\nThank you again for sharing your honest feedback. We’ve taken care of the concern you brought to our attention. If you would like, you can update your review during the next seven days. Your previous answers will already be filled in, and there is absolutely no pressure to make any changes.\n\nUpdate your review: ${reviewUrl}`,
    });
    return json(response, 200, { ok:true, guestName:booking.name, expiresAt });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'Reviews are unavailable.' });
  }
}
