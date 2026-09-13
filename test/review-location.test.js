import test from 'node:test';
import assert from 'node:assert/strict';
import { publicReviewLocation } from '../_lib/review-location.js';

test('uses booking city and full state name instead of the numeric location rating', () => {
  assert.equal(publicReviewLocation({ location:5 }, { billingCity:'Tucker', billingState:'GA' }), 'Tucker, Georgia');
});

test('preserves locations already stored on imported reviews', () => {
  assert.equal(publicReviewLocation({ location:'Knoxville, Tennessee' }, {}), 'Knoxville, Tennessee');
});
