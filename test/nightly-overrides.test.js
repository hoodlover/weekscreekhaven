import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteStay } from '../pricing.js';

const nightly = (arrival, departure, amountCents = 60000) => ({ arrival, departure, amountCents, pricingMode:'nightly' });
const price = (arrival, departure, rates = []) => quoteStay({ arrival, departure, rates, guests:4, pricingDate:'2026-10-12' });

test('saved Friday and Saturday nightly prices replace the seasonal weekend package',()=>{
  const quote=price('2026-11-06','2026-11-08',[nightly('2026-11-06','2026-11-08')]);
  assert.equal(quote.baseStayCents,120000);
  assert.deepEqual(quote.nightly.map(n=>n.amountCents),[60000,60000]);
  assert.equal(price('2026-11-06','2026-11-08').baseStayCents,67500);
});

test('checkout is excluded; other nights continue using seasonal prices',()=>{
  const rates=[nightly('2026-11-06','2026-11-08')];
  const quote=price('2026-11-06','2026-11-09',rates);
  assert.equal(quote.baseStayCents,147000);
  assert.deepEqual(quote.nightly.map(n=>n.amountCents),[60000,60000,27000]);
  assert.equal(price('2026-11-08','2026-11-10',rates).baseStayCents,54000);
});

test('a partially overridden weekend charges each selected night once',()=>{
  const rates=[nightly('2026-11-06','2026-11-07')];
  assert.equal(price('2026-11-06','2026-11-08',rates).baseStayCents,94000);
  // An override outside this stay must not change its seasonal package.
  assert.equal(price('2026-11-07','2026-11-09',rates).baseStayCents,94500);
  assert.equal(price('2026-11-07','2026-11-09',[nightly('2026-11-07','2026-11-09')]).baseStayCents,120000);
});

test('one-night minimum and weekly quotes both honor nightly overrides',()=>{
  assert.equal(price('2026-11-06','2026-11-07',[nightly('2026-11-06','2026-11-08')]).baseStayCents,120000);
  assert.equal(price('2026-11-06','2026-11-07').baseStayCents,67500);
  const quote=price('2026-11-06','2026-11-13',[nightly('2026-11-06','2026-11-13')]);
  assert.equal(quote.baseStayCents,420000);
});

test('explicit whole-stay packages keep their existing priority and amount',()=>{
  const rates=[{arrival:'2026-11-06',departure:'2026-11-08',pricingMode:'total',totalCents:80000,amountCents:40000,nightCount:2}];
  assert.equal(price('2026-11-06','2026-11-08',rates).baseStayCents,80000);
  rates.push(nightly('2026-11-09','2026-11-11'));
  assert.equal(price('2026-11-09','2026-11-11',rates).baseStayCents,120000);
  const weekly=price('2026-11-06','2026-11-13',rates);
  assert.deepEqual(weekly.nightly.map(n=>n.amountCents),[32000,32000,27000,60000,60000,27000,27000]);
  assert.equal(weekly.baseStayCents,265000);
});
