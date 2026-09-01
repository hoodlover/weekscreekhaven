import { get, list, put } from '@vercel/blob';
import { decryptRecord, encryptRecord } from './security.js';
import { normalizeFamilyChecklist, normalizeTurnoverChecklist } from './checklist-defaults.js';

const PREFIX = 'secure-cleaner/records/';

export const DEFAULT_INVENTORY = [
  ['toilet-paper','Toilet paper','Guest supplies'], ['paper-towels','Paper towels','Guest supplies'],
  ['trash-bags','Trash bags','Guest supplies'], ['dishwasher-pods','Dishwasher pods','Guest supplies'],
  ['trash-bags-30-gallon','30-gallon trash bags','Guest supplies'],
  ['trash-bags-drawstring','Heavy-duty drawstring trash bags','Guest supplies'],
  ['trash-bags-small','Small bathroom trash bags','Guest supplies'],
  ['trash-bags-kitchen','13-gallon kitchen trash bags','Guest supplies'],
  ['septic-treatment','Septic tank treatment','Guest supplies'],
  ['septic-treatment-monthly','Monthly septic treatment packets','Guest supplies'],
  ['dish-soap','Dish soap','Guest supplies'], ['hand-soap','Hand soap','Guest supplies'],
  ['hand-soap-citrus','Citrus hand soap refill','Guest supplies'],
  ['hand-soap-gentle','Gentle hand soap refill','Guest supplies'],
  ['coffee','Coffee & Keurig pods','Guest supplies'], ['hot-cocoa','Hot cocoa K-Cup pods','Guest supplies'],
  ['toiletries','Shampoo & body wash','Guest supplies'], ['clarifying-shampoo','Clarifying shampoo','Guest supplies'],
  ['all-purpose-cleaner','All-purpose cleaner','Cleaning'], ['disinfectant','Disinfectant','Cleaning'],
  ['disinfecting-wipes','Disinfecting wipes','Cleaning'],
  ['glass-cleaner','Glass cleaner','Cleaning'], ['bathroom-cleaner','Bathroom & toilet cleaner','Cleaning'],
  ['toilet-cleaner-tablets','Automatic toilet-cleaner tablets','Cleaning'],
  ['laundry','Laundry detergent & stain remover','Cleaning'], ['dryer-sheets','Dryer sheets','Cleaning'],
  ['sponges','Sponges & scrub pads','Cleaning'],
  ['steel-wool-pads','Steel wool soap pads','Cleaning'],
  ['hot-tub-chemicals','Hot-tub chemicals','Hot tub'], ['hot-tub-balancing-kit','Hot-tub balancing kit','Hot tub'],
  ['hot-tub-line-cleaner','Hot-tub jet-line cleaner','Hot tub'], ['hot-tub-test-strips','Hot-tub test strips','Hot tub'],
  ['charcoal','Charcoal','Outdoor'], ['propane','Grill & deck-heater propane','Outdoor'],
  ['matches-extra-long','10.9-inch safety matches','Outdoor'],
  ['matches-fireplace','8-inch fireplace matches','Outdoor'],
  ['bath-towels','Bath towels','Linens'], ['hot-tub-towels','Hot-tub towels','Linens'],
  ['washcloths','Washcloths & hand towels','Linens'], ['queen-sheets','Queen sheet sets','Linens'],
  ['king-sheets','King sheet sets','Linens'], ['pillowcases','Pillowcases','Linens'],
].map(([id,name,category]) => ({ id, name, category, level:'unknown', location:'', note:'', productUrl:'', productNote:'', productImageUrl:'', updatedAt:'' }))
  .map(item => ({...item,...({
    'toilet-paper':{productUrl:'https://a.co/d/08CLRmPA',productNote:'Scott Rapid-Dissolving Toilet Paper, 48 double rolls; septic-safe and designed for RVs and boats.'},
    'paper-towels':{productUrl:'https://a.co/d/04lVq6Hc',productNote:'Bounty Quick-Size paper towels with select-a-size sheets and high absorbency for using less per cleanup.'},
    'trash-bags':{productUrl:'https://a.co/d/00rJHX0n',productNote:'Husky contractor clean-up bags, 42 gallon, 3 mil heavy-duty, 20-count, black.'},
    'trash-bags-30-gallon':{productUrl:'https://a.co/d/09IWm3VV',productNote:'Hefty 30-gallon trash bags, 1.05 mil, with a puncture-resistant design for household cleanup.'},
    'trash-bags-drawstring':{productUrl:'https://a.co/d/08azjWUm',productNote:'Thick, leak-resistant trash bags made from durable HDPE with a convenient drawstring closure.'},
    'trash-bags-small':{productUrl:'https://a.co/d/025IdyQm',productNote:'Heihaily 2.6-gallon clear drawstring bags, 60-count, with a leak-resistant bottom for bathroom, office, or bedroom bins.'},
    'trash-bags-kitchen':{productUrl:'https://a.co/d/045xyUbR',productNote:'Glad ForceFlex 13-gallon tall kitchen bags, Pine-Sol Original scent, 40-count.'},
    'septic-treatment':{productUrl:'https://a.co/d/056gsRTI',productNote:'Vacplus septic tank treatment, 24 flushable dissolvable packets; a 2-year supply for waste and odor control.'},
    'septic-treatment-monthly':{productUrl:'https://a.co/d/0j14nivN',productNote:'Monthly dissolvable septic packets with selected bacteria cultures to break down waste and help maintain a healthy septic system.'},
    'hand-soap':{productUrl:'https://a.co/d/04fnFTTd',productNote:'Mango and coconut hand soap refills, two 50-ounce bottles; dermatologist-tested and triclosan-free.'},
    'hand-soap-citrus':{productUrl:'https://a.co/d/0ipOB1XI',productNote:'Amazon Basics citrus hand soap refills, two 50-fluid-ounce bottles; dermatologist-tested and pH-balanced.'},
    'hand-soap-gentle':{productUrl:'https://a.co/d/0cE5rLNV',productNote:'Dermatologist-tested, pH-balanced hand soap refill made without harsh chemicals.'},
    'coffee':{productUrl:'https://a.co/d/0fI2yO1U',productNote:'Starbucks Pike Place medium-roast coffee K-Cup pods with a smooth, balanced flavor.'},
    'hot-cocoa':{productUrl:'https://a.co/d/03b1nhul',productNote:'Swiss Miss Milk Chocolate hot cocoa K-Cup pods for Keurig brewers.'},
    'dish-soap':{productUrl:'https://a.co/d/05k2V7QE',productNote:'Versatile grease-cutting dish soap designed to reduce scrubbing and handle dishes, stains, and household cleaning.'},
    'dishwasher-pods':{productUrl:'https://a.co/d/0fyZXB48',productNote:'Cascade Platinum Plus dishwasher detergent pods, clean scent, 62-count.'},
    'clarifying-shampoo':{productUrl:'https://foodlion.com/product/suave-essentials-daily-clarifying-shampoo-22.5-oz-btl/397851',productNote:'Suave Essentials Daily Clarifying Shampoo, 22.5-fluid-ounce bottle.'},
    'all-purpose-cleaner':{productUrl:'https://a.co/d/08P5fVaD',productNote:'Formula 409 Lemon Fresh multi-surface cleaner, three 32-fluid-ounce bottles; cuts grease and grime and kills 99.9% of germs.',productImageUrl:'https://m.media-amazon.com/images/I/715-07w5icL._AC_SY300_SX300_QL70_ML2_.jpg'},
    'disinfectant':{productUrl:'https://a.co/d/0a2dOiYy',productNote:'Versatile all-purpose cleaner and disinfectant that cuts through grime and kills 99.9% of bacteria in 5 seconds.'},
    'disinfecting-wipes':{productUrl:'https://a.co/d/07xyX2ge',productNote:'Lysol disinfecting wipes, 4-pack, for sanitizing hard surfaces and eliminating 99.9% of viruses and bacteria.'},
    'glass-cleaner':{productUrl:'https://a.co/d/0egY6Rda',productNote:'Zep professional-grade glass cleaner for quickly removing dirt, fingerprints, and grime from windows and mirrors.'},
    'bathroom-cleaner':{productUrl:'https://www.amazon.com/dp/B00W5D1MDE',productNote:'Clorox Clinging Bleach toilet bowl cleaner for removing stains, deodorizing, and disinfecting the bowl.'},
    'toilet-cleaner-tablets':{productUrl:'https://www.amazon.com/dp/B0F1LZ1R6R',productNote:'Msvvko septic-safe automatic toilet-tank cleaner, 40 sustained-release blue tablets for stains and odor.'},
    'laundry':{productUrl:'https://a.co/d/0bFokgaJ',productNote:'Tide liquid laundry detergent for a deep clean and fresh scent.'},
    'dryer-sheets':{productUrl:'https://a.co/d/0j9CXmDp',productNote:'Snuggle Lavender Breeze dryer sheets, two 230-count boxes; softens fabric, reduces static and wrinkles, and helps repel lint and pet hair.'},
    'sponges':{productUrl:'https://a.co/d/0eV5B1fj',productNote:'Durable AIDEA sponges with non-scratch abrasive scour pads for tough messes; dishwasher-safe and long-lasting.'},
    'steel-wool-pads':{productUrl:'https://a.co/d/03uW5Pva',productNote:'Reusable lemon-scented steel wool soap pads for cutting through tough kitchen grease and grime.'},
    'hot-tub-chemicals':{productUrl:'https://a.co/d/05KbXln7',productNote:'BubbyShine 5-in-1 weekly hot-tub clarifier, cleaner, and conditioner; no draining required and compatible with chlorine or bromine.'},
    'hot-tub-balancing-kit':{productUrl:'https://a.co/d/0hHiHkVm',productNote:'Bio Ouster hot-tub balancing starter kit with pH Up, pH Down, alkalinity increaser, calcium hardness increaser, and test strips.'},
    'hot-tub-line-cleaner':{productUrl:'https://a.co/d/07cN32NG',productNote:'Paddle 16-ounce professional jet-line cleaner for deep-cleaning hot-tub, spa, and jetted-bathtub plumbing.'},
    'hot-tub-test-strips':{productUrl:'https://a.co/d/00XLoids',productNote:'Easy-read pool and spa test strips that measure seven key water parameters.'},
    'matches-extra-long':{productUrl:'https://a.co/d/0dqv0Xcy',productNote:'10.9-inch extra-long wooden safety matches, strike-on-box, 4-pack with 160 total; long reach for fireplaces, candles, grills, and firepits.'},
    'matches-fireplace':{productUrl:'https://a.co/d/0c8SK0w2',productNote:'8-inch wooden fireplace matches with black tips and included strikers, 100-count.'},
  }[item.id]||{})}))
  .map(item => item.productUrl ? {...item,level:'stocked'} : item);

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
    if(record.type==='inventory') {
      const current=inventory.get(record.item.id)||{};
      const productUrl=record.item.productUrl||current.productUrl||'',level=record.item.level==='unknown'&&productUrl?'stocked':record.item.level;
      inventory.set(record.item.id,{...current,...record.item,level,productUrl,productNote:record.item.productNote||current.productNote||''});
    }
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
