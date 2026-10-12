import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingGuestDiscount } from '../guest-identity.js';
import { applyFriendsAndFamilyDiscount, quoteStay } from '../pricing.js';
import { discountDescription, securityDepositCents, totalWithDeposit } from '../booking-price.js';
import { validStayDates } from '../_lib/guest-quote.js';
import { quote, discounts, booking, availability, inviteProfile, call, reset, adminCookie, inviteCookie, appendInviteRecord, appendBookingRecord, getBookingCalendar, seedFriend, friend, stay, bookingBody, blobs, approvals, failStorage } from '../test-support/booking-fixture.js';

test('phone-only legacy rules and normalized emails select the same saved rate; names never match',()=>{
  const standard=quoteStay(stay);
  assert.equal(matchingGuestDiscount({phone:'+1 (555) 867-5309'},[friend]),friend);
  assert.equal(matchingGuestDiscount({email:' FRIEND@EXAMPLE.TEST '},[friend]),friend);
  assert.equal(matchingGuestDiscount({name:friend.guestName},[friend]),null);
  assert.equal(applyFriendsAndFamilyDiscount(standard,friend.target,[friend]).totalCents,applyFriendsAndFamilyDiscount(standard,{email:friend.email},[friend]).totalCents);
  assert.throws(()=>matchingGuestDiscount({phone:friend.target,email:'other@example.test'},[friend,{...friend,id:'other',target:'5551112222',email:'other@example.test'}]),{status:409});
});

test('owner adds emails, edits an existing phone profile, and reloads encrypted records',async()=>{
  reset();await seedFriend();const cookie=adminCookie();
  const edited=await call(discounts,{method:'PATCH',cookie,body:{discountId:friend.id,target:friend.target,email:'NEW@EXAMPLE.TEST',guestName:'Example Friend',discountType:'percentage',value:25}});
  assert.equal(edited.code,200);assert.equal(edited.body.discount.email,'new@example.test');
  const added=await call(discounts,{cookie,body:{target:'5553334444 emailonly@example.test Email Friend\n(555) 111-2222 both@example.test Both Contacts',discountType:'amount',value:100}});
  assert.equal(added.code,201);assert.equal(added.body.discounts.length,2);
  const saved=(await getBookingCalendar()).discounts;
  assert.equal(matchingGuestDiscount({email:'emailonly@example.test'},saved).matchType,'phone');
  assert.equal(matchingGuestDiscount({phone:'5551112222'},saved).email,'both@example.test');
  assert.equal(matchingGuestDiscount({email:'new@example.test'},saved).percentage,25);
  assert.ok([...blobs.values()].every(blob=>!String(blob.data).includes('example.test')));
});

test('owner rejects duplicate contact aliases, malformed email, unauthenticated and cross-origin edits',async()=>{
  reset();await seedFriend();const cookie=adminCookie(),body={target:'5551112222 friend@example.test Duplicate',discountType:'percentage',value:10};
  assert.equal((await call(discounts,{body})).code,401);
  assert.equal((await call(discounts,{cookie,body,origin:'https://other.example.test'})).code,403);
  assert.equal((await call(discounts,{cookie,body})).code,409);
  assert.equal((await call(discounts,{cookie,body:{...body,target:'bad@ Example'}})).code,400);
  assert.equal((await getBookingCalendar()).discounts.length,1);
});

test('profile check returns only pricing flags; public GET and availability never expose private profiles',async()=>{
  reset();await seedFriend();
  const identified=await call(quote,{body:{action:'identify',phone:'+1 (555) 867-5309'}});
  assert.equal((await call(quote,{body:{action:'identify',email:friend.email}})).code,400);
  assert.deepEqual(identified.body,{privatePricing:true,complimentary:false});
  assert.match(identified.headers['Cache-Control'],/no-store/);
  const unknown=await call(quote,{body:{action:'identify',phone:'5559998888'}});
  assert.equal(unknown.body.privatePricing,false);
  const publicQuote=await call(quote,{method:'GET',query:{...stay,email:friend.email,phone:friend.target}});
  assert.equal(publicQuote.code,200);assert.equal(publicQuote.body.quote.friendsAndFamilyDiscount,undefined);
  const privateQuote=await call(quote,{body:{...stay,phone:friend.target}});
  const emailOnly=await call(quote,{body:{...stay,email:friend.email}});
  assert.equal(emailOnly.body.quote.friendsAndFamilyDiscount,undefined);
  assert.equal(privateQuote.code,200);assert.equal(privateQuote.body.quote.friendsAndFamilyDiscount.guestName,'');
  const calendar=await call(availability,{method:'GET'});
  assert.equal(JSON.stringify(calendar.body).includes(friend.email),false);
  assert.equal(JSON.stringify(calendar.body).includes(friend.guestName),false);
});

test('phone quote and final booking agree despite a different email; a changed reviewed total creates no booking or invoice',async()=>{
  reset();await seedFriend();
  const priced=await call(quote,{body:{...stay,phone:friend.target}}),total=totalWithDeposit(priced.body.quote);
  const rejected=await call(booking,{body:bookingBody({email:'different@example.test',reviewedTotalCents:total+100})});
  assert.equal(rejected.code,409);assert.equal(rejected.body.priceChanged,true);
  assert.equal((await getBookingCalendar()).bookings.length,0);assert.equal(approvals.length,0);
  const accepted=await call(booking,{body:bookingBody({email:'different@example.test',reviewedTotalCents:total})});
  assert.equal(accepted.code,201);assert.equal(totalWithDeposit(accepted.body.quotes[0]),total);
  assert.equal(approvals.length,1);assert.equal((await getBookingCalendar()).bookings[0].friendsAndFamilyDiscount.id,friend.id);
});

test('invited pricing is bound to the invitation and complimentary totals include no deposit',async()=>{
  reset();await seedFriend();
  const invite={id:'test-invite',label:'Test Invite',recipientPhone:'5559998888',recipientEmail:'invite@example.test',createdAt:'2026-01-01T00:00:00.000Z'};
  await appendInviteRecord({type:'created',invite,createdAt:invite.createdAt});
  const priced=await call(quote,{cookie:inviteCookie(invite.id),body:{...stay,phone:friend.target,email:friend.email}});
  assert.equal(priced.body.quote.friendsAndFamilyDiscount,undefined);
  reset();await seedFriend();await appendInviteRecord({type:'created',invite:{...invite,recipientEmail:friend.email,complimentary:true},createdAt:invite.createdAt});
  const profile=await call(inviteProfile,{method:'GET',cookie:inviteCookie(invite.id)});assert.equal(profile.body.privatePricingConnected,false);
  const free=await call(quote,{cookie:inviteCookie(invite.id),body:stay});
  assert.equal(totalWithDeposit(free.body.quote),0);assert.equal(securityDepositCents(free.body.quote),0);
  assert.match(discountDescription(free.body.quote),/complimentary stay.*You save.*No payment/);
});

test('invalid and unavailable dates cannot become bookings; email cannot override phone pricing',async()=>{
  reset();await seedFriend();
  assert.equal(validStayDates('2027-02-30','2027-03-04'),false);assert.equal(validStayDates('2027-01-01','2099-01-01'),false);
  assert.equal((await call(quote,{body:{...stay,arrival:'2027-02-30'}})).code,400);
  await appendBookingRecord({type:'block_created',createdAt:new Date().toISOString(),block:{id:'blocked',arrival:stay.arrival,departure:stay.departure}});
  assert.equal((await call(booking,{body:bookingBody()})).code,409);
  await seedFriend({...friend,id:'other',target:'5559998888',email:'other@example.test'});
  const phonePrice=await call(quote,{body:{...stay,phone:friend.target,email:'other@example.test'}});
  assert.equal(phonePrice.code,200);assert.equal(phonePrice.body.quote.friendsAndFamilyDiscount.percentage,friend.percentage);
  assert.equal((await getBookingCalendar()).bookings.length,0);
});

test('discount copy includes actual savings for percentage, dollar, flat, and complimentary rates',()=>{
  const standard=quoteStay(stay);
  for(const [discountType,values,pattern] of [['percentage',{percentage:20},/20% off/],['amount',{amountOffCents:10000},/\$100 off/],['flat',{flatTotalCents:30000},/saved whole-stay rate: \$300/],['complimentary',{},/complimentary stay/]]){
    const priced=applyFriendsAndFamilyDiscount(standard,friend.target,[{...friend,discountType,...values}]);
    assert.match(discountDescription(priced),pattern);assert.match(discountDescription(priced),/You save \$/);
  }
});

test('storage outage fails closed instead of returning a public-price fallback',async()=>{
  reset();failStorage(true);const original=console.error;console.error=()=>{};
  try { const result=await call(quote,{body:{...stay,email:friend.email}});assert.equal(result.code,503);assert.equal(result.body.quote,undefined); }
  finally {console.error=original;reset();}
});
