import { get, list, put } from '@vercel/blob';
import { decryptRecord, encryptRecord } from './security.js';
import { normalizeFamilyChecklist, normalizeTurnoverChecklist } from './checklist-defaults.js';

const PREFIX = 'secure-cleaner/records/';

export const DEFAULT_INVENTORY = [
  ['toilet-paper','Toilet paper','Guest supplies'], ['paper-towels','Paper towels','Guest supplies'],
  ['trash-bags','Trash bags','Guest supplies'], ['dishwasher-pods','Dishwasher pods','Guest supplies'],
  ['septic-treatment','Septic tank treatment','Guest supplies'],
  ['dish-soap','Dish soap','Guest supplies'], ['hand-soap','Hand soap','Guest supplies'],
  ['coffee','Coffee & Keurig pods','Guest supplies'], ['toiletries','Shampoo & body wash','Guest supplies'],
  ['all-purpose-cleaner','All-purpose cleaner','Cleaning'], ['disinfectant','Disinfectant','Cleaning'],
  ['glass-cleaner','Glass cleaner','Cleaning'], ['bathroom-cleaner','Bathroom & toilet cleaner','Cleaning'],
  ['laundry','Laundry detergent & stain remover','Cleaning'], ['sponges','Sponges & scrub pads','Cleaning'],
  ['hot-tub-chemicals','Hot-tub chemicals','Hot tub'], ['hot-tub-test-strips','Hot-tub test strips','Hot tub'],
  ['charcoal','Charcoal','Outdoor'], ['propane','Grill & deck-heater propane','Outdoor'],
  ['bath-towels','Bath towels','Linens'], ['hot-tub-towels','Hot-tub towels','Linens'],
  ['washcloths','Washcloths & hand towels','Linens'], ['queen-sheets','Queen sheet sets','Linens'],
  ['king-sheets','King sheet sets','Linens'], ['pillowcases','Pillowcases','Linens'],
].map(([id,name,category]) => ({ id, name, category, level:'unknown', note:'', productUrl:'', productNote:'', updatedAt:'' }))
  .map(item => ({...item,...({
    'toilet-paper':{productUrl:'https://a.co/d/08CLRmPA',productNote:'Scott Rapid-Dissolving Toilet Paper, 48 double rolls; septic-safe and designed for RVs and boats.'},
    'trash-bags':{productUrl:'https://a.co/d/00rJHX0n',productNote:'Husky contractor clean-up bags, 42 gallon, 3 mil heavy-duty, 20-count, black.'},
    'septic-treatment':{productUrl:'https://a.co/d/056gsRTI',productNote:'Vacplus septic tank treatment, 24 flushable dissolvable packets; a 2-year supply for waste and odor control.'},
    'sponges':{productUrl:'https://a.co/d/0eV5B1fj',productNote:'Durable AIDEA sponges with non-scratch abrasive scour pads for tough messes; dishwasher-safe and long-lasting.'},
  }[item.id]||{})}));

function token() { return process.env.INVITE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN; }
function ensureConfigured() { if (!token()) throw new Error('Cleaner storage is not configured.'); }

async function readBlob(blob) {
  const result = await get(blob.pathname, { access:'private', token:token() });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).text();
}

export async function appendCleanerRecord(record) {
  ensureConfigured();
  const createdAt = new Date(record.createdAt || Date.now()).toISOString();
  const stamp = createdAt.replace(/[:.]/g,'-');
  const value = { ...record, createdAt };
  await put(`${PREFIX}${stamp}-${crypto.randomUUID()}.json.enc`, encryptRecord(value), {
    access:'private', token:token(), contentType:'text/plain; charset=utf-8', addRandomSuffix:false, cacheControlMaxAge:60,
  });
  return value;
}

export async function uploadCleanerPhoto(bookingId, buffer, contentType, details={}) {
  ensureConfigured();
  const extension=contentType==='image/png'?'png':contentType==='image/webp'?'webp':'jpg';
  const id=crypto.randomUUID();
  const pathname=`secure-cleaner/photos/${bookingId}/${id}.${extension}`;
  await put(pathname,buffer,{access:'private',token:token(),contentType,addRandomSuffix:false,cacheControlMaxAge:3600});
  const photo={id,pathname,contentType,note:String(details.note||'').slice(0,500),capturedAt:details.capturedAt||'',uploadedAt:new Date().toISOString(),uploadedBy:details.uploadedBy||'cleaner'};
  await appendCleanerRecord({type:'cleaning_photo',bookingId,photo,createdAt:photo.uploadedAt});
  return photo;
}

export async function getCleanerPhoto(pathname) {
  ensureConfigured();
  return get(pathname,{access:'private',token:token()});
}

export async function getCleanerRecords() {
  ensureConfigured();
  const records=[]; let cursor;
  do {
    const page=await list({ prefix:PREFIX, cursor, limit:1000, token:token() });
    const values=await Promise.all(page.blobs.map(async blob=>{ try{return decryptRecord(await readBlob(blob));}catch{return null;} }));
    records.push(...values.filter(Boolean)); cursor=page.hasMore?page.cursor:undefined;
  } while(cursor);
  return records.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getCleanerState() {
  const records=await getCleanerRecords();
  const settings={ cleanerName:'Cabin Care Team', cleanerEmail:'', standardPayCents:17500, doorCode:'', closetCode:'', doorCodeUpdatedAt:'', passcodeHash:'', passcodeSalt:'', cleanerAuthVersion:'', familyCheckoutChecklist:normalizeFamilyChecklist(), turnoverChecklistMaster:normalizeTurnoverChecklist(), checklistsUpdatedAt:'' };
  const inventory=new Map(DEFAULT_INVENTORY.map(item=>[item.id,{...item}]));
  const assignments=new Map(); const remarks=new Map(); const tips=new Map(); const serviceOffers=new Map(); const conversations=new Map(); const cleaningPhotos=new Map(); const emailHistory=[];
  for (const record of records) {
    if(record.type==='settings') Object.assign(settings,record.changes||{});
    if(record.type==='inventory') inventory.set(record.item.id,{...(inventory.get(record.item.id)||{}),...record.item});
    if(record.type==='assignment') assignments.set(record.bookingId,{...(assignments.get(record.bookingId)||{bookingId:record.bookingId}),...(record.changes||{}),updatedAt:record.createdAt});
    if(record.type==='remark') remarks.set(record.remark.id,record.remark);
    if(record.type==='remark_update'&&remarks.has(record.remarkId)) Object.assign(remarks.get(record.remarkId),record.changes,{updatedAt:record.createdAt});
    if(record.type==='tip') tips.set(record.tip.id,record.tip);
    if(record.type==='tip_update'&&tips.has(record.tipId)) Object.assign(tips.get(record.tipId),record.changes,{updatedAt:record.createdAt});
    if(record.type==='cleaner_email_sent') emailHistory.push(record.email);
    if(record.type==='service_offer') serviceOffers.set(record.offer.id,record.offer);
    if(record.type==='service_offer_update'&&serviceOffers.has(record.offerId)) Object.assign(serviceOffers.get(record.offerId),record.changes,{updatedAt:record.createdAt});
    if(record.type==='conversation') conversations.set(record.conversation.id,{...record.conversation,messages:[...(record.conversation.messages||[])]});
    if(record.type==='conversation_message'&&conversations.has(record.conversationId)) conversations.get(record.conversationId).messages.push(record.message);
    if(record.type==='conversation_message_delivery'&&conversations.has(record.conversationId)){
      const message=conversations.get(record.conversationId).messages.find(item=>item.id===record.messageId);
      if(message)Object.assign(message,record.changes,{updatedAt:record.createdAt});
    }
    if(record.type==='conversation_update'&&conversations.has(record.conversationId)) Object.assign(conversations.get(record.conversationId),record.changes,{updatedAt:record.createdAt});
    if(record.type==='cleaning_photo') cleaningPhotos.set(record.photo.id,{...record.photo,bookingId:record.bookingId});
  }
  settings.familyCheckoutChecklist=normalizeFamilyChecklist(settings.familyCheckoutChecklist);
  settings.turnoverChecklistMaster=normalizeTurnoverChecklist(settings.turnoverChecklistMaster);
  return { settings, inventory:[...inventory.values()], assignments:[...assignments.values()], remarks:[...remarks.values()], tips:[...tips.values()], serviceOffers:[...serviceOffers.values()], conversations:[...conversations.values()], cleaningPhotos:[...cleaningPhotos.values()], emailHistory };
}
