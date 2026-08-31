import crypto from 'node:crypto';
import { appendCleanerRecord, getCleanerState } from '../_lib/cleaner-store.js';
import { getBookingRequests } from '../_lib/booking-store.js';
import { getSquareOrder } from '../_lib/square.js';
import { hashPasscode, json, requireAdmin, requireCleaner, sameOriginRequest } from '../_lib/security.js';

const safe=(value,max=500)=>String(value||'').trim().slice(0,max);
const cents=value=>Math.round(Number(value)*100);
function todayEastern(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${o.year}-${o.month}-${o.day}`;}
function stay(booking){return booking.dateChoices?.[Number.isInteger(booking.approvedChoice)?booking.approvedChoice:0]||booking.dateChoices?.[0]||{};}
function cleanerScheduled(booking){const dates=stay(booking),rule=booking.friendsAndFamilyDiscount||dates.quote?.friendsAndFamilyDiscount;return !(rule&&rule.chargeCleaning!==true);}
function within(iso,days){const time=Date.parse(iso||'');return Number.isFinite(time)&&time>=Date.now()-days*86400000;}

async function syncTips(state){
  const pending=state.tips.filter(t=>t.status==='pending'&&t.squareOrderId).slice(-30);
  let changed=false;
  await Promise.all(pending.map(async tip=>{try{
    const order=await getSquareOrder(tip.squareOrderId);
    if(order?.state==='COMPLETED'){
      await appendCleanerRecord({type:'tip_update',tipId:tip.id,changes:{status:'paid',paidAt:order.closed_at||order.updated_at||new Date().toISOString(),squareOrderState:order.state}}); changed=true;
    } else if(order?.state==='CANCELED'){
      await appendCleanerRecord({type:'tip_update',tipId:tip.id,changes:{status:'cancelled',squareOrderState:order.state}}); changed=true;
    }
  }catch{/* Keep pending; the next live refresh will try again. */}}));
  return changed?getCleanerState():state;
}

function buildDashboard(bookings,state,isOwner){
  const today=todayEastern();
  const booked=bookings.filter(b=>['booked','completed'].includes(b.status)||b.paymentFullyPaid);
  const bookedStays=booked.map(b=>({booking:b,dates:stay(b)})).filter(x=>x.dates.arrival&&x.dates.departure);
  const assignmentMap=new Map(state.assignments.map(a=>[a.bookingId,a]));
  const upcoming=bookedStays.filter(x=>x.dates.departure>=today&&cleanerScheduled(x.booking)).sort((a,b)=>a.dates.departure.localeCompare(b.dates.departure)).slice(0,16).map(({booking,dates})=>{
    const assignment=assignmentMap.get(booking.id)||{};
    const nextArrival=bookedStays.find(x=>x.dates.arrival===dates.departure&&x.booking.id!==booking.id);
    return {
      bookingId:booking.id, arrival:dates.arrival, cleanDate:dates.departure, guests:Number(booking.guests)||1, dogs:Number(booking.dogs)||0,
      sameDayTurnaround:Boolean(nextArrival), nextGuestCount:nextArrival?Number(nextArrival.booking.guests)||1:0,
      status:assignment.status||'scheduled', ownerNote:assignment.ownerNote||'', cleanerNote:assignment.cleanerNote||'',
      basePayCents:Number.isFinite(Number(assignment.basePayCents))?Number(assignment.basePayCents):(Number.isFinite(Number(booking.accountingCleaningFeeCents))?Number(booking.accountingCleaningFeeCents):Number(state.settings.standardPayCents)||17500),
      extraPayCents:Number(assignment.extraPayCents)||0, extraTask:assignment.extraTask||'', completedAt:assignment.completedAt||'', paidAt:assignment.paidAt||'',
      ...(isOwner?{guestName:booking.name||'Guest'}:{}),
    };
  });
  const recent=bookedStays.filter(x=>x.dates.departure<today).sort((a,b)=>b.dates.departure.localeCompare(a.dates.departure)).slice(0,8).map(({booking,dates})=>{
    const report=booking.checkoutReport||{}; const assignment=assignmentMap.get(booking.id)||{};
    return { bookingId:booking.id,departure:dates.departure,guests:Number(booking.guests)||1,restock:report.restock||[],maintenanceCategories:report.maintenanceCategories||[],maintenanceLocation:report.maintenanceLocation||'',maintenancePriority:report.maintenancePriority||'',maintenanceIssue:report.maintenanceIssue||'',nothingToReport:report.nothingToReport===true,cleanerNote:assignment.cleanerNote||'',status:assignment.status||'',...(isOwner?{guestName:booking.name||'Guest'}:{}) };
  });
  const paidTips=state.tips.filter(t=>t.status==='paid');
  const completedJobs=state.assignments.filter(a=>a.completedAt).map(a=>({...a,earnedCents:(Number(a.basePayCents)||Number(state.settings.standardPayCents)||17500)+(Number(a.extraPayCents)||0),earnedAt:a.completedAt}));
  const earnings=[...paidTips.map(t=>({kind:'tip',amountCents:Number(t.amountCents)||0,earnedAt:t.paidAt,paidOutAt:t.paidOutAt||''})),...completedJobs.map(j=>({kind:'cleaning',amountCents:j.earnedCents,earnedAt:j.earnedAt,paidOutAt:j.paidAt||''}))];
  const totalFor=days=>earnings.filter(e=>within(e.earnedAt,days)).reduce((sum,e)=>sum+e.amountCents,0);
  return {
    isOwner, cleanerName:state.settings.cleanerName, standardPayCents:state.settings.standardPayCents, doorCode:state.settings.doorCode||'', closetCode:state.settings.closetCode||'', doorCodeUpdatedAt:state.settings.doorCodeUpdatedAt||'',
    inventory:state.inventory.sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name)), upcoming, recent,
    remarks:state.remarks.filter(r=>r.status!=='resolved').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),
    tips:paidTips.sort((a,b)=>String(b.paidAt).localeCompare(String(a.paidAt))).slice(0,50).map(t=>({id:t.id,guestFirstName:t.guestFirstName,amountCents:t.amountCents,paidAt:t.paidAt,paidOutAt:t.paidOutAt||''})),
    money:{owedCents:earnings.filter(e=>!e.paidOutAt).reduce((sum,e)=>sum+e.amountCents,0),monthCents:totalFor(30),quarterCents:totalFor(90),yearCents:totalFor(365)},
    updatedAt:new Date().toISOString(),
  };
}

export default async function handler(request,response){
  const owner=Boolean(requireAdmin(request)); const stateAtEntry=await getCleanerState().catch(()=>({settings:{}})); const cleanerSession=requireCleaner(request);
  const cleaner=Boolean(cleanerSession&&cleanerSession.authVersion===(stateAtEntry.settings?.cleanerAuthVersion||''));
  if(!owner&&!cleaner)return json(response,401,{error:'Please sign in to the Cleaner Hub.',setupRequired:!stateAtEntry.settings?.passcodeHash},{'Cache-Control':'no-store'});
  if(request.method!=='GET'&&!sameOriginRequest(request))return json(response,403,{error:'This update was blocked.'});
  try{
    if(request.method==='GET'){
      let state=await getCleanerState(); state=await syncTips(state);
      return json(response,200,buildDashboard(await getBookingRequests(),state,owner),{'Cache-Control':'private, no-store'});
    }
    if(request.method!=='POST')return json(response,405,{error:'Method not allowed.'});
    const action=safe(request.body?.action,40); const now=new Date().toISOString();
    if(action==='setup-access'){
      if(!owner)return json(response,403,{error:'Only the owner can change cleaner access.'});
      const passcode=safe(request.body?.passcode,80); if(passcode.length<6)return json(response,400,{error:'Use at least 6 characters for the cleaner access code.'});
      const hashed=hashPasscode(passcode); await appendCleanerRecord({type:'settings',createdAt:now,changes:{passcodeHash:hashed.hash,passcodeSalt:hashed.salt,cleanerAuthVersion:crypto.randomUUID()}});
    } else if(action==='settings'){
      if(!owner)return json(response,403,{error:'Only the owner can change pay settings.'});
      const standardPayCents=cents(request.body?.standardPay); if(!Number.isInteger(standardPayCents)||standardPayCents<0||standardPayCents>100000)return json(response,400,{error:'Enter a valid standard cleaning pay.'});
      const doorCode=safe(request.body?.doorCode,12).replace(/\s+/g,'');
      if(doorCode&&!/^\d{4,10}$/.test(doorCode))return json(response,400,{error:'Use a 4–10 digit cleaner door code.'});
      const closetCode=safe(request.body?.closetCode,12).replace(/\s+/g,'');
      if(closetCode&&!/^\d{3,10}$/.test(closetCode))return json(response,400,{error:'Use a 3–10 digit closet-lock code.'});
      await appendCleanerRecord({type:'settings',createdAt:now,changes:{cleanerName:safe(request.body?.cleanerName,80)||'Cabin Care Team',standardPayCents,doorCode,closetCode,doorCodeUpdatedAt:now}});
    } else if(action==='inventory'){
      const id=safe(request.body?.id,80).toLowerCase().replace(/[^a-z0-9-]/g,'-'); const name=safe(request.body?.name,100); const level=safe(request.body?.level,20);
      if(!id||!name||!['stocked','low','out','unknown'].includes(level))return json(response,400,{error:'Choose an item and its current stock level.'});
      await appendCleanerRecord({type:'inventory',createdAt:now,item:{id,name,category:safe(request.body?.category,60)||'Other',level,note:safe(request.body?.note,240),updatedAt:now,updatedBy:owner?'owner':'cleaner'}});
    } else if(action==='remark'){
      const body=safe(request.body?.body,1000); if(!body)return json(response,400,{error:'Add the note or item needed.'});
      await appendCleanerRecord({type:'remark',createdAt:now,remark:{id:crypto.randomUUID(),body,category:safe(request.body?.category,40)||'Help needed',priority:['normal','soon','urgent'].includes(request.body?.priority)?request.body.priority:'normal',status:'open',author:owner?'owner':'cleaner',createdAt:now}});
    } else if(action==='resolve-remark'){
      await appendCleanerRecord({type:'remark_update',remarkId:safe(request.body?.remarkId,80),createdAt:now,changes:{status:'resolved',resolvedAt:now,resolvedBy:owner?'owner':'cleaner'}});
    } else if(action==='assignment'){
      const bookingId=safe(request.body?.bookingId,100); const state=await getCleanerState(); const current=state.assignments.find(a=>a.bookingId===bookingId)||{}; let changes={};
      if(owner){
        const basePayCents=cents(request.body?.basePay); const extraPayCents=cents(request.body?.extraPay||0);
        if(!Number.isInteger(basePayCents)||basePayCents<0||basePayCents>100000||!Number.isInteger(extraPayCents)||extraPayCents<0||extraPayCents>100000)return json(response,400,{error:'Enter valid cleaning and extra-task pay amounts.'});
        changes={basePayCents,extraPayCents,extraTask:safe(request.body?.extraTask,500),ownerNote:safe(request.body?.ownerNote,500),status:safe(request.body?.status,30)||current.status||'scheduled'};
        if(request.body?.markPaid===true)changes.paidAt=now;
      } else {
        const status=safe(request.body?.status,30); if(!['accepted','completed'].includes(status))return json(response,400,{error:'Choose accepted or completed.'});
        changes={status,cleanerNote:safe(request.body?.cleanerNote,500)}; if(status==='completed')changes.completedAt=now;
      }
      await appendCleanerRecord({type:'assignment',bookingId,createdAt:now,changes});
    } else if(action==='tip-paid-out'){
      if(!owner)return json(response,403,{error:'Only the owner can record tip payout.'});
      await appendCleanerRecord({type:'tip_update',tipId:safe(request.body?.tipId,80),createdAt:now,changes:{paidOutAt:now}});
    } else return json(response,400,{error:'Unknown cleaner hub update.'});
    return json(response,200,{ok:true},{'Cache-Control':'private, no-store'});
  }catch(error){console.error(error);return json(response,503,{error:error.message||'The Cleaner Hub is temporarily unavailable.'});}
}
