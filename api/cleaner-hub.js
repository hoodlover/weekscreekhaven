import crypto from 'node:crypto';
import { appendCleanerRecord, getCleanerState } from '../_lib/cleaner-store.js';
import { getBookingRequests } from '../_lib/booking-store.js';
import { getSquareOrder } from '../_lib/square.js';
import { hashPasscode, json, requireAdmin, requireCleaner, sameOriginRequest } from '../_lib/security.js';
import { escapeEmailHtml, sendEmail } from '../_lib/email.js';
import { normalizeTurnoverChecklist } from '../_lib/checklist-defaults.js';

const safe=(value,max=500)=>String(value||'').trim().slice(0,max);
function safeProductUrl(value){const raw=safe(value,1000);if(!raw)return'';try{const url=new URL(raw);return ['http:','https:'].includes(url.protocol)?url.toString():'';}catch{return'';}}
const cents=value=>Math.round(Number(value)*100);
const HUB_URL='https://www.weekscreekhaven.com/cleaner.html';
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(value)||0)/100);
const dateTime=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));
const firstName=value=>safe(value,100).split(/\s+/)[0]||'Guest';
const CHECK_STATUSES=new Set(['','inspected','done','attention']);
function todayEastern(){const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${o.year}-${o.month}-${o.day}`;}
function stay(booking){return booking.dateChoices?.[Number.isInteger(booking.approvedChoice)?booking.approvedChoice:0]||booking.dateChoices?.[0]||{};}
function cleanerScheduled(booking){const dates=stay(booking),rule=booking.friendsAndFamilyDiscount||dates.quote?.friendsAndFamilyDiscount;return !(rule&&rule.chargeCleaning!==true);}
function within(iso,days){const time=Date.parse(iso||'');return Number.isFinite(time)&&time>=Date.now()-days*86400000;}
function checkoutReportFor(booking){
  const report=booking.checkoutReport;
  if(!report||(!report.submittedAt&&!report.restock?.length&&!report.maintenanceCategories?.length&&!report.maintenanceIssue&&!report.nothingToReport))return null;
  return {restock:Array.isArray(report.restock)?report.restock.slice(0,30):[],maintenanceCategories:Array.isArray(report.maintenanceCategories)?report.maintenanceCategories.slice(0,20):[],maintenanceLocation:safe(report.maintenanceLocation,200),maintenancePriority:safe(report.maintenancePriority,40),maintenanceIssue:safe(report.maintenanceIssue,1500),nothingToReport:report.nothingToReport===true,checklistCompleted:report.checklistCompleted===true,checklistItems:Array.isArray(report.checklistItems)?report.checklistItems.map(item=>safe(item,100)).filter(Boolean).slice(0,20):[],checklistExpected:Array.isArray(report.checklistExpected)?report.checklistExpected.map(item=>safe(item,100)).filter(Boolean).slice(0,20):[],submittedAt:safe(report.submittedAt,40)};
}
function checklistFrom(body,keys){return Object.fromEntries(keys.map(key=>[key,CHECK_STATUSES.has(body?.[key])?body[key]:'']));}

async function hubEmail({to,toName,subject,text,key}){
  if(!to)return {skipped:true};
  return sendEmail({to,toName,subject,text,idempotencyKey:key,html:`<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.65;max-width:620px"><h1 style="color:#183c2d">${escapeEmailHtml(subject)}</h1><p>${escapeEmailHtml(text).replace(/\n/g,'<br>')}</p><p><a href="${HUB_URL}" style="display:inline-block;background:#183c2d;color:#fff;padding:12px 19px;border-radius:999px;text-decoration:none;font-weight:bold">Open Cleaner Hub</a></p></div>`});
}

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
  const photosFor=bookingId=>state.cleaningPhotos.filter(photo=>photo.bookingId===bookingId).sort((a,b)=>String(a.capturedAt||a.uploadedAt).localeCompare(String(b.capturedAt||b.uploadedAt))).map(photo=>({id:photo.id,note:photo.note||'',capturedAt:photo.capturedAt||'',uploadedAt:photo.uploadedAt,uploadedBy:photo.uploadedBy||'cleaner',url:`/api/cleaner-photo?photoId=${encodeURIComponent(photo.id)}`}));
  let upcoming=bookedStays.filter(x=>x.dates.departure>=today&&cleanerScheduled(x.booking)).sort((a,b)=>a.dates.departure.localeCompare(b.dates.departure)).slice(0,16).map(({booking,dates})=>{
    const assignment=assignmentMap.get(booking.id)||{};
    const nextArrival=bookedStays.find(x=>x.dates.arrival===dates.departure&&x.booking.id!==booking.id);
    return {
      bookingId:booking.id, arrival:dates.arrival, cleanDate:dates.departure, guests:Number(booking.guests)||1, dogs:Number(booking.dogs)||0, guestFirstName:firstName(booking.name), guestRating:Number(assignment.guestRating)||0, guestReview:assignment.guestReview||'', guestRatedAt:assignment.guestRatedAt||'', familyChecklist:assignment.familyChecklist||{}, familyChecklistNote:assignment.familyChecklistNote||'', familyChecklistUpdatedAt:assignment.familyChecklistUpdatedAt||'', turnoverChecklist:assignment.turnoverChecklist||{}, turnoverChecklistNote:assignment.turnoverChecklistNote||'', turnoverChecklistUpdatedAt:assignment.turnoverChecklistUpdatedAt||'', checkoutReport:checkoutReportFor(booking), cleanerScheduled:true,
      sessionType:assignment.sessionType||(booking.friendsAndFamilyDiscount||dates.quote?.friendsAndFamilyDiscount?'friends-family':'guest'),
      sameDayTurnaround:Boolean(nextArrival), nextGuestCount:nextArrival?Number(nextArrival.booking.guests)||1:0,
      status:assignment.status||'scheduled', ownerNote:assignment.ownerNote||'', cleanerNote:assignment.cleanerNote||'',
      basePayCents:Number.isFinite(Number(assignment.basePayCents))?Number(assignment.basePayCents):(Number.isFinite(Number(booking.accountingCleaningFeeCents))?Number(booking.accountingCleaningFeeCents):Number(state.settings.standardPayCents)||17500),
      extraPayCents:Number(assignment.extraPayCents)||0, extraTask:assignment.extraTask||'', completedAt:assignment.completedAt||'', paidAt:assignment.paidAt||'',
      photos:photosFor(booking.id),
      ...(isOwner?{guestName:booking.name||'Guest'}:{}),
    };
  });
  let recent=bookedStays.filter(x=>x.dates.departure<today).sort((a,b)=>b.dates.departure.localeCompare(a.dates.departure)).slice(0,8).map(({booking,dates})=>{
    const report=checkoutReportFor(booking); const assignment=assignmentMap.get(booking.id)||{};
    return { bookingId:booking.id,departure:dates.departure,guests:Number(booking.guests)||1,guestFirstName:firstName(booking.name),guestRating:Number(assignment.guestRating)||0,guestReview:assignment.guestReview||'',guestRatedAt:assignment.guestRatedAt||'',sessionType:assignment.sessionType||(booking.friendsAndFamilyDiscount||dates.quote?.friendsAndFamilyDiscount?'friends-family':'guest'),familyChecklist:assignment.familyChecklist||{},familyChecklistNote:assignment.familyChecklistNote||'',familyChecklistUpdatedAt:assignment.familyChecklistUpdatedAt||'',turnoverChecklist:assignment.turnoverChecklist||{},turnoverChecklistNote:assignment.turnoverChecklistNote||'',turnoverChecklistUpdatedAt:assignment.turnoverChecklistUpdatedAt||'',checkoutReport:report,cleanerScheduled:cleanerScheduled(booking),restock:report?.restock||[],maintenanceCategories:report?.maintenanceCategories||[],maintenanceLocation:report?.maintenanceLocation||'',maintenancePriority:report?.maintenancePriority||'',maintenanceIssue:report?.maintenanceIssue||'',nothingToReport:report?.nothingToReport===true,cleanerNote:assignment.cleanerNote||'',status:assignment.status||'',photos:photosFor(booking.id),...(isOwner?{guestName:booking.name||'Guest'}:{}) };
  });
  const customSessions=state.assignments.filter(item=>item.customSession&&item.cleanDate).map(item=>({bookingId:item.bookingId,arrival:item.cleanDate,cleanDate:item.cleanDate,departure:item.cleanDate,guests:Number(item.guests)||0,guestFirstName:'the group',guestRating:Number(item.guestRating)||0,guestReview:item.guestReview||'',guestRatedAt:item.guestRatedAt||'',familyChecklist:item.familyChecklist||{},familyChecklistNote:item.familyChecklistNote||'',familyChecklistUpdatedAt:item.familyChecklistUpdatedAt||'',turnoverChecklist:item.turnoverChecklist||{},turnoverChecklistNote:item.turnoverChecklistNote||'',turnoverChecklistUpdatedAt:item.turnoverChecklistUpdatedAt||'',checkoutReport:null,cleanerScheduled:true,dogs:0,sameDayTurnaround:false,nextGuestCount:0,status:item.status||'scheduled',sessionType:item.sessionType||'guest',ownerNote:item.ownerNote||'',cleanerNote:item.cleanerNote||'',basePayCents:Number(item.basePayCents)||0,extraPayCents:Number(item.extraPayCents)||0,extraTask:item.extraTask||'',completedAt:item.completedAt||'',paidAt:item.paidAt||'',customSession:true,sessionLabel:item.sessionLabel||'Additional cabin care',photos:photosFor(item.bookingId)}));
  upcoming=[...upcoming,...customSessions.filter(item=>item.cleanDate>=today)].sort((a,b)=>a.cleanDate.localeCompare(b.cleanDate)).slice(0,20);
  recent=[...recent,...customSessions.filter(item=>item.cleanDate<today)].sort((a,b)=>b.departure.localeCompare(a.departure)).slice(0,12);
  const paidTips=state.tips.filter(t=>t.status==='paid');
  const completedJobs=state.assignments.filter(a=>a.completedAt).map(a=>({...a,earnedCents:(Number(a.basePayCents)||Number(state.settings.standardPayCents)||17500)+(Number(a.extraPayCents)||0),earnedAt:a.completedAt}));
  const completedServices=state.serviceOffers.filter(o=>['completed','paid'].includes(o.status)&&o.completedAt).map(o=>({kind:'service',amountCents:Number(o.amountCents)||0,earnedAt:o.completedAt,paidOutAt:o.paidAt||''}));
  const compensation=[...completedJobs.map(j=>({kind:'cleaning',amountCents:j.earnedCents,earnedAt:j.earnedAt,paidOutAt:j.paidAt||''})),...completedServices];
  const acceptedCents=upcoming.filter(item=>item.status==='accepted'&&!item.completedAt).reduce((sum,item)=>sum+(Number(item.basePayCents)||0)+(Number(item.extraPayCents)||0),0)+state.serviceOffers.filter(item=>item.status==='accepted').reduce((sum,item)=>sum+(Number(item.amountCents)||0),0);
  const paidFor=days=>compensation.filter(e=>within(e.paidOutAt,days)).reduce((sum,e)=>sum+e.amountCents,0);
  const tipSummary={owedCents:paidTips.filter(t=>!t.paidOutAt).reduce((sum,t)=>sum+(Number(t.amountCents)||0),0),paidCents:paidTips.filter(t=>t.paidOutAt).reduce((sum,t)=>sum+(Number(t.amountCents)||0),0)};
  return {
    isOwner, cleanerName:state.settings.cleanerName, cleanerEmail:isOwner?(state.settings.cleanerEmail||''):'', standardPayCents:state.settings.standardPayCents, doorCode:state.settings.doorCode||'', closetCode:state.settings.closetCode||'', doorCodeUpdatedAt:state.settings.doorCodeUpdatedAt||'', turnoverChecklistMaster:normalizeTurnoverChecklist(state.settings.turnoverChecklistMaster),
    inventory:state.inventory.sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name)), upcoming, recent,
    remarks:state.remarks.filter(r=>r.status!=='resolved').sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),
    serviceOffers:state.serviceOffers.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,50),
    conversations:state.conversations.sort((a,b)=>String(b.messages?.at(-1)?.createdAt||b.createdAt).localeCompare(String(a.messages?.at(-1)?.createdAt||a.createdAt))).slice(0,30),
    tips:paidTips.sort((a,b)=>String(b.paidAt).localeCompare(String(a.paidAt))).slice(0,50).map(t=>({id:t.id,guestFirstName:t.guestFirstName,amountCents:t.amountCents,paidAt:t.paidAt,paidOutAt:t.paidOutAt||''})),
    tipSummary,
    money:{acceptedCents,owedCents:compensation.filter(e=>!e.paidOutAt).reduce((sum,e)=>sum+e.amountCents,0),paidMonthCents:paidFor(30),paidYearCents:paidFor(365)},
    emailHistory:isOwner?state.emailHistory.slice(-12).reverse():[],
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
      const cleanerEmail=safe(request.body?.cleanerEmail,160).toLowerCase();
      if(cleanerEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanerEmail))return json(response,400,{error:'Enter a valid cleaner email address.'});
      const doorCode=safe(request.body?.doorCode,12).replace(/\s+/g,'');
      if(doorCode&&!/^\d{4,10}$/.test(doorCode))return json(response,400,{error:'Use a 4–10 digit cleaner door code.'});
      const closetCode=safe(request.body?.closetCode,12).replace(/\s+/g,'');
      if(closetCode&&!/^\d{3,10}$/.test(closetCode))return json(response,400,{error:'Use a 3–10 digit closet-lock code.'});
      await appendCleanerRecord({type:'settings',createdAt:now,changes:{cleanerName:safe(request.body?.cleanerName,80)||'Cabin Care Team',cleanerEmail,standardPayCents,doorCode,closetCode,doorCodeUpdatedAt:now}});
    } else if(action==='inventory'){
      const id=safe(request.body?.id,80).toLowerCase().replace(/[^a-z0-9-]/g,'-'); const name=safe(request.body?.name,100); const level=safe(request.body?.level,20);
      if(!id||!name||!['stocked','low','out','unknown'].includes(level))return json(response,400,{error:'Choose an item and its current stock level.'});
      const productUrl=safeProductUrl(request.body?.productUrl);if(request.body?.productUrl&&!productUrl)return json(response,400,{error:'Paste a valid product link beginning with http:// or https://.'});
      await appendCleanerRecord({type:'inventory',createdAt:now,item:{id,name,category:safe(request.body?.category,60)||'Other',level,note:safe(request.body?.note,240),productUrl,productNote:safe(request.body?.productNote,400),updatedAt:now,updatedBy:owner?'owner':'cleaner'}});
    } else if(action==='remark'){
      const body=safe(request.body?.body,1000); if(!body)return json(response,400,{error:'Add the note or item needed.'});
      await appendCleanerRecord({type:'remark',createdAt:now,remark:{id:crypto.randomUUID(),body,category:safe(request.body?.category,40)||'Help needed',priority:['normal','soon','urgent'].includes(request.body?.priority)?request.body.priority:'normal',status:'open',author:owner?'owner':'cleaner',createdAt:now}});
    } else if(action==='resolve-remark'){
      await appendCleanerRecord({type:'remark_update',remarkId:safe(request.body?.remarkId,80),createdAt:now,changes:{status:'resolved',resolvedAt:now,resolvedBy:owner?'owner':'cleaner'}});
    } else if(action==='create-cleaning-session'){
      if(!owner)return json(response,403,{error:'Only the owner can add a cleaning session.'});
      const cleanDate=safe(request.body?.cleanDate,10),sessionLabel=safe(request.body?.sessionLabel,100)||'Additional cabin care',sessionType=request.body?.sessionType==='friends-family'?'friends-family':'guest',guests=Number(request.body?.guests)||0,basePayCents=cents(request.body?.basePay||0),ownerNote=safe(request.body?.ownerNote,500);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)||Number.isNaN(Date.parse(`${cleanDate}T12:00:00`)))return json(response,400,{error:'Choose a valid cleaning date.'});
      if(!Number.isInteger(basePayCents)||basePayCents<0||basePayCents>100000)return json(response,400,{error:'Enter a valid cleaning amount.'});
      if(!Number.isInteger(guests)||guests<0||guests>30)return json(response,400,{error:'Enter a guest count from 0 to 30.'});
      await appendCleanerRecord({type:'assignment',bookingId:`custom-${crypto.randomUUID()}`,createdAt:now,changes:{customSession:true,cleanDate,sessionLabel,sessionType,guests,basePayCents,extraPayCents:0,extraTask:'',ownerNote,status:'scheduled'}});
    } else if(action==='assignment'){
      const bookingId=safe(request.body?.bookingId,100); const state=await getCleanerState(); const current=state.assignments.find(a=>a.bookingId===bookingId)||{}; let changes={};
      if(owner){
        const basePayCents=cents(request.body?.basePay); const extraPayCents=cents(request.body?.extraPay||0);
        if(!Number.isInteger(basePayCents)||basePayCents<0||basePayCents>100000||!Number.isInteger(extraPayCents)||extraPayCents<0||extraPayCents>100000)return json(response,400,{error:'Enter valid cleaning and extra-task pay amounts.'});
        changes={basePayCents,extraPayCents,extraTask:safe(request.body?.extraTask,500),ownerNote:safe(request.body?.ownerNote,500),status:safe(request.body?.status,30)||current.status||'scheduled',sessionType:request.body?.sessionType==='friends-family'?'friends-family':'guest'};
        if(request.body?.markPaid===true)changes.paidAt=now;
      } else {
        const status=safe(request.body?.status,30); if(!['accepted','completed'].includes(status))return json(response,400,{error:'Choose accepted or completed.'});
        changes={status,cleanerNote:safe(request.body?.cleanerNote,500)}; if(status==='completed')changes.completedAt=now;
      }
      await appendCleanerRecord({type:'assignment',bookingId,createdAt:now,changes});
    } else if(action==='guest-review'){
      if(!cleaner)return json(response,403,{error:'Sign in as the cleaner to rate this visit.'});
      const bookingId=safe(request.body?.bookingId,100),guestRating=Number(request.body?.rating),guestReview=safe(request.body?.review,1000);
      const state=await getCleanerState(),bookings=await getBookingRequests();
      if(!state.assignments.some(item=>item.bookingId===bookingId)&&!bookings.some(item=>item.id===bookingId))return json(response,404,{error:'Cleaning session not found.'});
      if(!Number.isInteger(guestRating)||guestRating<1||guestRating>5)return json(response,400,{error:'Choose a rating from one to five stars.'});
      if(!guestReview)return json(response,400,{error:'Add a short note about how the cabin was left.'});
      await appendCleanerRecord({type:'assignment',bookingId,createdAt:now,changes:{guestRating,guestReview,guestRatedAt:now}});
    } else if(action==='turnover-checklist'){
      if(!cleaner)return json(response,403,{error:'Sign in as the cleaner to record this turnover.'});
      const bookingId=safe(request.body?.bookingId,100),state=await getCleanerState(),bookings=await getBookingRequests();
      if(!state.assignments.some(item=>item.bookingId===bookingId)&&!bookings.some(item=>item.id===bookingId))return json(response,404,{error:'Cleaning session not found.'});
      const turnoverKeys=normalizeTurnoverChecklist(state.settings.turnoverChecklistMaster).flatMap(group=>group.tasks.map(task=>task.id));
      const turnoverChecklist=checklistFrom(request.body,turnoverKeys);
      await appendCleanerRecord({type:'assignment',bookingId,createdAt:now,changes:{turnoverChecklist,turnoverChecklistNote:safe(request.body?.note,1500),turnoverChecklistUpdatedAt:now}});
    } else if(action==='tip-paid-out'){
      if(!owner)return json(response,403,{error:'Only the owner can record tip payout.'});
      await appendCleanerRecord({type:'tip_update',tipId:safe(request.body?.tipId,80),createdAt:now,changes:{paidOutAt:now}});
    } else if(action==='create-service-offer'){
      if(!owner)return json(response,403,{error:'Only the owner can create a paid service offer.'});
      const state=await getCleanerState(),title=safe(request.body?.title,120),details=safe(request.body?.details,1500),amountCents=cents(request.body?.amount),acceptBy=safe(request.body?.acceptBy,40),completeBy=safe(request.body?.completeBy,40),operationId=safe(request.body?.operationId,80);
      if(state.serviceOffers.some(item=>item.operationId===operationId))return json(response,200,{ok:true,alreadyCreated:true});
      const acceptMs=Date.parse(acceptBy),completeMs=Date.parse(completeBy);
      if(!title||!details)return json(response,400,{error:'Add the service and what you would like done.'});
      if(!Number.isInteger(amountCents)||amountCents<100||amountCents>500000)return json(response,400,{error:'Offer an amount between $1 and $5,000.'});
      if(!Number.isFinite(acceptMs)||acceptMs<=Date.now())return json(response,400,{error:'Choose a future acceptance deadline.'});
      if(!Number.isFinite(completeMs)||completeMs<=acceptMs)return json(response,400,{error:'The completion deadline must be after the acceptance deadline.'});
      if(!state.settings.cleanerEmail)return json(response,400,{error:'Add the cleaner email address before creating an offer.'});
      const offer={id:crypto.randomUUID(),operationId,title,details,amountCents,acceptBy:new Date(acceptMs).toISOString(),completeBy:new Date(completeMs).toISOString(),status:'offered',createdAt:now,createdBy:'owner'};
      await hubEmail({to:state.settings.cleanerEmail,toName:state.settings.cleanerName,subject:`Paid service offer · ${title}`,text:`Hi ${state.settings.cleanerName},\n\nHeather and Lance are offering ${money(amountCents)} for this service:\n\n${details}\n\nPlease accept or decline by ${dateTime(offer.acceptBy)}. If accepted, complete it by ${dateTime(offer.completeBy)}. Open the Cleaner Hub to respond.`,key:`cleaner-offer-${offer.id}-created`});
      await appendCleanerRecord({type:'service_offer',createdAt:now,offer});
    } else if(action==='service-offer-response'){
      if(!cleaner)return json(response,403,{error:'Sign in as the cleaner to answer this offer.'});
      const state=await getCleanerState(),offer=state.serviceOffers.find(item=>item.id===safe(request.body?.offerId,80)),decision=safe(request.body?.decision,20);
      if(!offer)return json(response,404,{error:'This service offer could not be found.'});
      if(offer.status!=='offered')return json(response,409,{error:'This offer has already been answered or closed.'});
      if(Date.now()>Date.parse(offer.acceptBy))return json(response,409,{error:'The acceptance deadline has passed. Ask the owner to create a new offer.'});
      if(!['accepted','declined'].includes(decision))return json(response,400,{error:'Accept or decline the service offer.'});
      const changes={status:decision,[decision==='accepted'?'acceptedAt':'declinedAt']:now,responseNote:safe(request.body?.note,500)};
      await appendCleanerRecord({type:'service_offer_update',offerId:offer.id,createdAt:now,changes});
      const verb=decision==='accepted'?'accepted':'declined',note=changes.responseNote?`\n\nCleaner note: ${changes.responseNote}`:'';
      await Promise.allSettled([
        hubEmail({to:state.settings.cleanerEmail,toName:state.settings.cleanerName,subject:`Service offer ${verb} · ${offer.title}`,text:`Hi ${state.settings.cleanerName},\n\nYou ${verb} “${offer.title}” for ${money(offer.amountCents)}.${decision==='accepted'?` It is due by ${dateTime(offer.completeBy)}.`:''}${note}`,key:`cleaner-offer-${offer.id}-${verb}-cleaner`}),
        hubEmail({to:process.env.OWNER_EMAIL,toName:'Heather & Lance',subject:`Cleaner ${verb} service offer · ${offer.title}`,text:`${state.settings.cleanerName} ${verb} “${offer.title}” for ${money(offer.amountCents)}.${note}`,key:`cleaner-offer-${offer.id}-${verb}-owner`}),
      ]);
    } else if(action==='complete-service-offer'){
      if(!cleaner)return json(response,403,{error:'Sign in as the cleaner to complete this service.'});
      const state=await getCleanerState(),offer=state.serviceOffers.find(item=>item.id===safe(request.body?.offerId,80));
      if(!offer)return json(response,404,{error:'This service offer could not be found.'});
      if(offer.status!=='accepted')return json(response,409,{error:'Only an accepted service can be marked complete.'});
      const completionNote=safe(request.body?.note,1000);
      await appendCleanerRecord({type:'service_offer_update',offerId:offer.id,createdAt:now,changes:{status:'completed',completedAt:now,completionNote}});
      const note=completionNote?`\n\nCompletion note: ${completionNote}`:'';
      await Promise.allSettled([
        hubEmail({to:process.env.OWNER_EMAIL,toName:'Heather & Lance',subject:`Ready to pay · ${offer.title}`,text:`${state.settings.cleanerName} marked “${offer.title}” complete. Amount due: ${money(offer.amountCents)}.${note}\n\nOpen the Cleaner Hub to review and mark it paid.`,key:`cleaner-offer-${offer.id}-completed-owner`}),
        hubEmail({to:state.settings.cleanerEmail,toName:state.settings.cleanerName,subject:`Completion recorded · ${offer.title}`,text:`Hi ${state.settings.cleanerName},\n\nYour completion of “${offer.title}” was recorded. ${money(offer.amountCents)} now appears as owed in your Cleaner Hub.${note}`,key:`cleaner-offer-${offer.id}-completed-cleaner`}),
      ]);
    } else if(action==='close-service-offer'){
      if(!owner)return json(response,403,{error:'Only the owner can close or pay an offer.'});
      const state=await getCleanerState(),offer=state.serviceOffers.find(item=>item.id===safe(request.body?.offerId,80)),decision=safe(request.body?.decision,20);
      if(!offer)return json(response,404,{error:'This service offer could not be found.'});
      if(decision==='paid'){
        if(offer.status!=='completed')return json(response,409,{error:'Review the completed service before marking it paid.'});
        await appendCleanerRecord({type:'service_offer_update',offerId:offer.id,createdAt:now,changes:{status:'paid',paidAt:now}});
        await Promise.allSettled([hubEmail({to:state.settings.cleanerEmail,toName:state.settings.cleanerName,subject:`Payment recorded · ${offer.title}`,text:`Hi ${state.settings.cleanerName},\n\nHeather and Lance recorded ${money(offer.amountCents)} as paid for “${offer.title}.” Please send a message in the Hub if anything does not match.`,key:`cleaner-offer-${offer.id}-paid`})]);
      }else if(decision==='withdrawn'){
        if(!['offered','expired','declined'].includes(offer.status))return json(response,409,{error:'An accepted or completed service cannot be withdrawn.'});
        await appendCleanerRecord({type:'service_offer_update',offerId:offer.id,createdAt:now,changes:{status:'withdrawn',withdrawnAt:now}});
      }else return json(response,400,{error:'Choose paid or withdrawn.'});
    } else if(action==='start-conversation'){
      const state=await getCleanerState(),subject=safe(request.body?.subject,120),body=safe(request.body?.body,1500),author=owner?'owner':'cleaner',alsoEmail=request.body?.alsoEmail===true;
      if(!subject||!body)return json(response,400,{error:'Add a short subject and message.'});
      const id=crypto.randomUUID(),message={id:crypto.randomUUID(),body,author,createdAt:now,delivery:alsoEmail?'email-pending':'hub'};
      await appendCleanerRecord({type:'conversation',createdAt:now,conversation:{id,subject,status:'open',createdAt:now,createdBy:author,messages:[message]}});
      const to=owner?state.settings.cleanerEmail:process.env.OWNER_EMAIL,toName=owner?state.settings.cleanerName:'Heather & Lance',from=owner?'Heather & Lance':state.settings.cleanerName;
      if(alsoEmail){let changes={delivery:'email-failed'};try{const result=await hubEmail({to,toName,subject:`Cleaner Hub message · ${subject}`,text:`${from} posted a new message:\n\n${body}\n\nReply inside the Cleaner Hub so the full conversation stays together.`,key:`cleaner-conversation-${id}-message-${message.id}`});if(!result?.skipped)changes={delivery:'email',emailedAt:now}}catch(error){console.error('Cleaner Hub conversation email failed',error)}await appendCleanerRecord({type:'conversation_message_delivery',conversationId:id,messageId:message.id,createdAt:now,changes});}
    } else if(action==='reply-conversation'){
      const state=await getCleanerState(),conversation=state.conversations.find(item=>item.id===safe(request.body?.conversationId,80)),body=safe(request.body?.body,1500),author=owner?'owner':'cleaner',alsoEmail=request.body?.alsoEmail===true;
      if(!conversation)return json(response,404,{error:'This conversation could not be found.'});
      if(conversation.status==='closed')return json(response,409,{error:'Reopen this conversation before replying.'});
      if(!body)return json(response,400,{error:'Write a reply first.'});
      const message={id:crypto.randomUUID(),body,author,createdAt:now,delivery:alsoEmail?'email-pending':'hub'};
      await appendCleanerRecord({type:'conversation_message',conversationId:conversation.id,createdAt:now,message});
      const to=owner?state.settings.cleanerEmail:process.env.OWNER_EMAIL,toName=owner?state.settings.cleanerName:'Heather & Lance',from=owner?'Heather & Lance':state.settings.cleanerName;
      if(alsoEmail){let changes={delivery:'email-failed'};try{const result=await hubEmail({to,toName,subject:`Reply · ${conversation.subject}`,text:`${from} replied in the Cleaner Hub:\n\n${body}\n\nOpen the conversation to reply.`,key:`cleaner-conversation-${conversation.id}-message-${message.id}`});if(!result?.skipped)changes={delivery:'email',emailedAt:now}}catch(error){console.error('Cleaner Hub reply email failed',error)}await appendCleanerRecord({type:'conversation_message_delivery',conversationId:conversation.id,messageId:message.id,createdAt:now,changes});}
    } else if(action==='conversation-status'){
      const state=await getCleanerState(),conversation=state.conversations.find(item=>item.id===safe(request.body?.conversationId,80)),status=safe(request.body?.status,20);
      if(!conversation)return json(response,404,{error:'This conversation could not be found.'});
      if(!['open','closed'].includes(status))return json(response,400,{error:'Choose open or closed.'});
      await appendCleanerRecord({type:'conversation_update',conversationId:conversation.id,createdAt:now,changes:{status,[status==='closed'?'closedAt':'reopenedAt']:now}});
    } else if(action==='send-email'){
      if(!owner)return json(response,403,{error:'Only the owner can email the cleaner.'});
      if(request.body?.confirmed!==true)return json(response,400,{error:'Review and confirm this cleaner email before sending.'});
      const state=await getCleanerState(); const to=state.settings.cleanerEmail||'';
      if(!to)return json(response,400,{error:'Add the cleaner email address in Cleaner setup first.'});
      const subject=safe(request.body?.subject,160),body=safe(request.body?.body,5000),operationId=safe(request.body?.operationId,80);
      if(subject.length<5||body.length<20||!operationId)return json(response,400,{error:'Finish the email subject and message before sending.'});
      const already=state.emailHistory.find(item=>item.operationId===operationId); if(already)return json(response,200,{ok:true,alreadySent:true});
      const htmlBody=escapeEmailHtml(body).replace(/\n/g,'<br>');
      const result=await sendEmail({to,toName:state.settings.cleanerName||'Cabin Care Team',subject,idempotencyKey:`cleaner-${operationId}`,text:body,html:`<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.65;max-width:640px"><div style="padding:22px;background:#183c2d;color:#fff"><div style="color:#e5b67e;font-size:12px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase">Weeks Creek Haven · Cabin Care</div><h1 style="margin:6px 0 0;color:#fff;font-family:Georgia,serif">${escapeEmailHtml(subject)}</h1></div><div style="padding:24px;background:#fffdf8">${htmlBody}</div><div style="padding:16px 24px;background:#f4eee0;color:#76695e;font-size:12px">Weeks Creek Haven · Blue Ridge, Georgia</div></div>`});
      await appendCleanerRecord({type:'cleaner_email_sent',createdAt:now,email:{id:crypto.randomUUID(),operationId,to,subject,templateId:safe(request.body?.templateId,50),sentAt:now,provider:result?.provider||''}});
    } else return json(response,400,{error:'Unknown cleaner hub update.'});
    return json(response,200,{ok:true},{'Cache-Control':'private, no-store'});
  }catch(error){console.error(error);return json(response,503,{error:error.message||'The Cleaner Hub is temporarily unavailable.'});}
}
