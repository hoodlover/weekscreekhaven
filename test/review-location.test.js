import test from 'node:test';
import assert from 'node:assert/strict';
import { publicReviewLocation } from '../_lib/review-location.js';
import { currentReviewVersions } from '../_lib/review-store.js';

test('uses booking city and full state name instead of the numeric location rating', () => {
  assert.equal(publicReviewLocation({ location:5 }, { billingCity:'Tucker', billingState:'GA' }), 'Tucker, Georgia');
});

test('preserves locations already stored on imported reviews', () => {
  assert.equal(publicReviewLocation({ location:'Knoxville, Tennessee' }, {}), 'Knoxville, Tennessee');
});

test('keeps the newest review public and preserves earlier versions privately', () => {
  const [current] = currentReviewVersions([
    { id:'new', bookingId:'booking-1', createdAt:'2026-09-14T12:00:00Z', overall:5 },
    { id:'old', bookingId:'booking-1', createdAt:'2026-09-13T12:00:00Z', overall:3 },
  ]);
  assert.equal(current.id, 'new');
  assert.deepEqual(current.previousVersions.map((review) => review.id), ['old']);
});
