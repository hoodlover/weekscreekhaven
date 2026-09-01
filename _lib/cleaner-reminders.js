import { appendCleanerRecord, getCleanerState } from './cleaner-store.js';
import { escapeEmailHtml, sendEmail } from './email.js';

const HUB_URL='https://cleaner.weekscreekhaven.com/';
const money=cents=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format((Number(cents)||0)/100);
const when=value=>new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value));

async function emailCleaner(settings,{subject,text,key}){
  if(!settings.cleanerEmail)return false;
  const result=await sendEmail({to:settings.cleanerEmail,toName:settings.cleanerName||'Cabin Care Team',subject,text,html:`<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.65;max-width:620px"><h1 style="color:#183c2d">${escapeEmailHtml(subject)}</h1><p>${escapeEmailHtml(text).replace(/\n/g,'<br>')}</p><p><a href="${HUB_URL}" style="display:inline-block;background:#183c2d;color:#fff;padding:12px 19px;border-radius:999px;text-decoration:none;font-weight:bold">Open Cleaner Hub</a></p></div>`,idempotencyKey:key});
  return !result?.skipped;
}

export async function processCleanerReminders(now=new Date()){
  const state=await getCleanerState(); let sent=0; const nowMs=now.getTime();
  for(const offer of state.serviceOffers){
    const acceptMs=Date.parse(offer.acceptBy||''),completeMs=Date.parse(offer.completeBy||'');
    if(offer.status==='offered'&&Number.isFinite(acceptMs)&&nowMs>=acceptMs&&!offer.expiredAt){
      const createdAt=now.toISOString();
      await appendCleanerRecord({type:'service_offer_update',offerId:offer.id,createdAt,changes:{status:'expired',expiredAt:createdAt}});
      if(await emailCleaner(state.settings,{subject:`Service offer expired · ${offer.title}`,text:`Hi ${state.settings.cleanerName},\n\nThe acceptance window closed for “${offer.title}.” No action is needed unless you and the owners decide to reopen it.`,key:`cleaner-offer-${offer.id}-expired`}))sent++;
      continue;
    }
    if(offer.status==='offered'&&Number.isFinite(acceptMs)&&nowMs>=acceptMs-24*3600000&&!offer.acceptReminderSentAt){
      if(await emailCleaner(state.settings,{subject:`Reminder · service offer needs an answer`,text:`Hi ${state.settings.cleanerName},\n\nPlease accept or decline “${offer.title}” by ${when(offer.acceptBy)}. The offered amount is ${money(offer.amountCents)}.`,key:`cleaner-offer-${offer.id}-accept-reminder`})){
        const createdAt=now.toISOString();await appendCleanerRecord({type:'service_offer_update',offerId:offer.id,createdAt,changes:{acceptReminderSentAt:createdAt}});sent++;
      }
    }
    if(offer.status==='accepted'&&Number.isFinite(completeMs)&&nowMs>=completeMs-24*3600000&&!offer.completeReminderSentAt){
      if(await emailCleaner(state.settings,{subject:`Reminder · ${offer.title}`,text:`Hi ${state.settings.cleanerName},\n\nThis is a reminder that “${offer.title}” is due by ${when(offer.completeBy)}. Mark it complete in the Cleaner Hub when it is finished.`,key:`cleaner-offer-${offer.id}-complete-reminder`})){
        const createdAt=now.toISOString();await appendCleanerRecord({type:'service_offer_update',offerId:offer.id,createdAt,changes:{completeReminderSentAt:createdAt}});sent++;
      }
    }
  }
  return sent;
}
