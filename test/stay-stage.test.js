import test from 'node:test';
import assert from 'node:assert/strict';
import { stayStage } from '../_lib/stay-stage.js';

test('labels reservation timing around the stay', () => {
  const stay={ status:'booked', arrival:'2026-10-23', departure:'2026-10-25' };
  assert.equal(stayStage(stay,'2026-10-22'),'before');
  assert.equal(stayStage(stay,'2026-10-24'),'during');
  assert.equal(stayStage(stay,'2026-10-26'),'after');
});

test('completed stays are after-stay even on checkout day', () => {
  assert.equal(stayStage({status:'completed',arrival:'2026-10-23',departure:'2026-10-25'},'2026-10-25'),'after');
});
