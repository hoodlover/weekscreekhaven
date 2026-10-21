import { cleanerOwnsCleaning } from '../_lib/cleaner-assignments.js';
import { getCleanerPhoto, getCleanerState, uploadCleanerPhoto } from '../_lib/cleaner-store.js';
import { getBookingRequests } from '../_lib/booking-store.js';
import { enforceRateLimit, json, requireAdmin, requireCleaner, sameOriginRequest } from '../_lib/security.js';
import { cleanerForSession } from '../_lib/cleaner-profiles.js';

const ALLOWED_TYPES=new Set(['image/jpeg','image/png','image/webp']);
const MAX_BYTES=2*1024*1024;

async function authorization(request){
  const owner=Boolean(requireAdmin(request));
  const state=await getCleanerState();
  const session=requireCleaner(request);
  const cleaner=cleanerForSession(session,state);
  return {owner,cleaner,state};
}

export default async function handler(request,response){
  try{
    const {owner,cleaner,state}=await authorization(request);
    if(!owner&&!cleaner)return json(response,401,{error:'Please sign in to the Cleaner Hub.'},{'Cache-Control':'no-store'});
    if(request.method==='GET'){
      const photo=state.cleaningPhotos.find(item=>item.id===String(request.query?.photoId||''));
      if(!photo)return response.status(404).end();
      if(!owner&&!cleanerOwnsCleaning(state,photo.bookingId,cleaner.id))return json(response,403,{error:'This cleaning is assigned to another cleaner.'});
      const result=await getCleanerPhoto(photo.pathname);
      if(!result||result.statusCode!==200)return response.status(404).end();
      const body=Buffer.from(await new Response(result.stream).arrayBuffer());
      response.setHeader('Content-Type',result.blob.contentType||photo.contentType||'image/jpeg');
      response.setHeader('Cache-Control','private, no-store');
      response.setHeader('X-Content-Type-Options','nosniff');
      return response.status(200).end(body);
    }
    if(request.method!=='POST')return json(response,405,{error:'Method not allowed.'});
    if(!sameOriginRequest(request))return json(response,403,{error:'Open the Cleaner Hub from this website.'});
    const rate=enforceRateLimit(request,'cleaner-photo',250,30*60*1000);
    if(!rate.allowed)return json(response,429,{error:'Too many photos at once. Wait a few minutes and try again.'});
    const bookingId=String(request.body?.bookingId||'').trim().slice(0,100);
    const purpose=request.body?.purpose==='guest-feedback'?'guest-feedback':'cleaning';
    if(purpose==='guest-feedback'&&!owner)return json(response,403,{error:'Only the owner can attach prior guest feedback photos.'});
    const contentType=String(request.body?.contentType||'').toLowerCase();
    const note=String(request.body?.note||'').trim().slice(0,500);
    const capturedAt=String(request.body?.capturedAt||'').trim();
    const data=String(request.body?.data||'');
    if(!bookingId)return json(response,400,{error:'Choose a cleaning session first.'});
    const bookings=await getBookingRequests();
    const sessionExists=bookings.some(item=>item.id===bookingId)||state.assignments.some(item=>item.bookingId===bookingId&&item.customSession);
    if(!owner&&!cleanerOwnsCleaning(state,bookingId,cleaner.id))return json(response,403,{error:'This cleaning is assigned to another cleaner.'});
    if(!sessionExists)return json(response,404,{error:'Cleaning session not found.'});
    const uploadId=String(request.body?.uploadId||'').slice(0,80);
    const duplicate=uploadId&&state.cleaningPhotos.find(item=>item.bookingId===bookingId&&(item.purpose||'cleaning')===purpose&&item.uploadId===uploadId);
    if(duplicate)return json(response,200,{photo:{id:duplicate.id}});
    const existing=state.cleaningPhotos.filter(item=>item.bookingId===bookingId&&(item.purpose||'cleaning')===purpose),limit=purpose==='guest-feedback'?5:100;
    if(existing.length>=limit)return json(response,400,{error:`This section already has ${limit} photos.`});
    if(!ALLOWED_TYPES.has(contentType))return json(response,400,{error:'Use a JPG, PNG, or WebP photo.'});
    const match=data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if(!match||match[1]!==contentType)return json(response,400,{error:'That photo could not be read.'});
    const buffer=Buffer.from(match[2],'base64');
    if(!buffer.length||buffer.length>MAX_BYTES)return json(response,400,{error:'Keep each prepared photo under 2 MB.'});
    const normalizedCapturedAt=Number.isNaN(Date.parse(capturedAt))?'':new Date(capturedAt).toISOString();
    const photo=await uploadCleanerPhoto(bookingId,buffer,contentType,{purpose,uploadId,note,capturedAt:normalizedCapturedAt,uploadedBy:owner?'owner':cleaner.cleanerName});
    return json(response,201,{photo:{id:photo.id,note:photo.note,capturedAt:photo.capturedAt,uploadedAt:photo.uploadedAt,uploadedBy:photo.uploadedBy}});
  }catch(error){
    console.error(error);
    return json(response,503,{error:'The photo could not be saved. Please try again.'});
  }
}
