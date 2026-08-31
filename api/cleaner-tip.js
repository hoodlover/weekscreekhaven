import crypto from 'node:crypto';
import { appendCleanerRecord, getCleanerState } from '../_lib/cleaner-store.js';
import { getBookingRequests } from '../_lib/booking-store.js';
import { createSquareCleanerTipLink } from '../_lib/square.js';
import { enforceRateLimit, json, rateLimitJson, sameOriginRequest, verifyAgreementToken } from '../_lib/security.js';

export default async function handler(request,response){
  if(request.method!=='POST')return json(response,405,{error:'Method not allowed.'});
  if(!sameOriginRequest(request))return json(response,403,{error:'Open the tip page from your private reservation.'});
  const rate=enforceRateLimit(request,'cleaner-tip',5,30*60*1000); if(!rate.allowed)return rateLimitJson(response,rate);
  try{
    const token=verifyAgreementToken(String(request.body?.token||''));
    if(!token)return json(response,401,{error:'This private reservation link is invalid or expired.'});
    const booking=(await getBookingRequests()).find(item=>item.id===token.bookingId);
    if(!booking||['cancelled','declined'].includes(booking.status))return json(response,404,{error:'This stay could not be found.'});
    const dates=booking.dateChoices?.[Number.isInteger(booking.approvedChoice)?booking.approvedChoice:0]||booking.dateChoices?.[0]||{};
    const cleaningRule=booking.friendsAndFamilyDiscount||dates.quote?.friendsAndFamilyDiscount;
    if(cleaningRule&&cleaningRule.chargeCleaning!==true)return json(response,409,{error:'No cleaner was scheduled for this stay.'});
    const amountCents=Math.round(Number(request.body?.amount)*100);
    if(!Number.isInteger(amountCents)||amountCents<100||amountCents>50000)return json(response,400,{error:'Choose a tip between $1 and $500.'});
    const state=await getCleanerState();
    const existing=state.tips.find(tip=>tip.bookingId===booking.id&&tip.amountCents===amountCents&&tip.status==='pending'&&Date.now()-Date.parse(tip.createdAt)<30*60*1000);
    if(existing?.url)return json(response,200,{url:existing.url});
    const tipId=crypto.randomUUID();
    const link=await createSquareCleanerTipLink({tipId,bookingId:booking.id,guestName:booking.name||'Guest',email:booking.email||'',amountCents});
    const createdAt=new Date().toISOString();
    await appendCleanerRecord({type:'tip',createdAt,tip:{id:tipId,bookingId:booking.id,guestFirstName:String(booking.name||'Guest').trim().split(/\s+/)[0],amountCents,status:'pending',squareOrderId:link.orderId,squarePaymentLinkId:link.id,url:link.url,createdAt}});
    return json(response,200,{url:link.url});
  }catch(error){console.error(error);return json(response,503,{error:error.message||'The tip link could not be created.'});}
}
