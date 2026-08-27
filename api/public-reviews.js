import { combinedReviews } from '../_lib/legacy-reviews.js';
import { getReviews } from '../_lib/review-store.js';
import { json } from '../_lib/security.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  try {
    let storedReviews = [];
    try { storedReviews = await getReviews(); } catch (error) { console.error('Stored reviews unavailable:', error); }
    const reviews = combinedReviews(storedReviews)
      .filter((review) => review.allowTestimonial && review.publicComments)
      .map((review) => ({
        id: review.id,
        displayName: review.displayName || review.guestName,
        location: review.location || '',
        overall: Number(review.overall) || 5,
        publicComments: review.publicComments,
        createdAt: review.createdAt,
        source: review.source || 'Guest review',
        previousOwnership: Boolean(review.previousOwnership),
      }));
    return json(response, 200, { reviews }, { 'Cache-Control': 'public, max-age=300, s-maxage=900' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Guest reviews are temporarily unavailable.' });
  }
}
