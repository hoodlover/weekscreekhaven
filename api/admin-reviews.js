import { getReviews } from '../_lib/review-store.js';
import { combinedReviews } from '../_lib/legacy-reviews.js';
import { json, requireAdmin } from '../_lib/security.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  try {
    return json(response, 200, { reviews: combinedReviews(await getReviews()) }, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: error.message || 'Reviews are unavailable.' });
  }
}
