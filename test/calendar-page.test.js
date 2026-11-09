import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('calendar page module initializes without JavaScript syntax errors',()=>{
  const html=readFileSync(new URL('../calendar.html',import.meta.url),'utf8');
  const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const checked=spawnSync(process.execPath,['--input-type=module','--check'],{input:script,encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
});

test('calendar renderer preserves Airbnb checkout, connects stays and keeps booking links', async()=>{
  const {runInNewContext}=await import('node:vm');
  const {calendarWeeks,turnoverDates}=await import('../calendar-layout.js');
  const html=readFileSync(new URL('../calendar.html',import.meta.url),'utf8');
  const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  const source=script.slice(script.indexOf('    const state='),script.indexOf('    async function load()'));
  const elements={};
  const document={getElementById:id=>elements[id]??={}};
  runInNewContext(source+`;state.month=new Date(2026,11,1);state.bookings=[{id:'direct',name:'Friends',status:'booked',dateChoices:[{arrival:'2026-12-22',departure:'2026-12-24'}]}];state.externalEntries=[{arrival:'2026-12-19',departure:'2026-12-22'}];render();`,{document,calendarWeeks,turnoverDates,renderOwnerCalculator(){},money:()=>'',Date,Intl,URL});
  assert.match(elements.calendar.innerHTML,/checkout 2026-12-22/);
  assert.doesNotMatch(elements.calendar.innerHTML,/checkout 2026-12-21/);
  assert.match(elements.calendar.innerHTML,/data-date="2026-12-22"[^]*?Same-day turnover/);
  assert.match(elements.calendar.innerHTML,/href="https:\/\/owner.weekscreekhaven.com\/\?booking=direct"/);
  assert.equal((elements.calendar.innerHTML.match(/class="calendar-week"/g)||[]).length,6);
});
