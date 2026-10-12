import { registerHooks } from 'node:module';
import crypto from 'node:crypto';

process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.INVITE_BLOB_READ_WRITE_TOKEN = 'test-only-in-memory';
process.env.INVITE_BLOB_ACCESS = 'private';
globalThis.fetch = async () => { throw new Error('External requests are forbidden in booking tests'); };
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@vercel/blob' || specifier === 'test:booking-blob') return { url: 'test:booking-blob', shortCircuit: true };
    if (specifier.endsWith('/email.js')) return { url: 'test:booking-email', shortCircuit: true };
    if (specifier.endsWith('/auto-booking.js') || specifier === 'test:booking-approval') return { url: 'test:booking-approval', shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'test:booking-email') return { format: 'module', shortCircuit: true, source: `export const emailConfigured=()=>false, escapeEmailHtml=String; export async function sendEmail(){throw new Error('Email forbidden in tests');}` };
    if (url === 'test:booking-approval') return { format: 'module', shortCircuit: true, source: `export const approvals=[];export async function automaticallyApproveBooking(booking){approvals.push(booking);return {...booking,autoApproved:true};}` };
    if (url !== 'test:booking-blob') return next(url, context);
    return { format: 'module', shortCircuit: true, source: `
      export const blobs=new Map();export let unavailable=false;export function failStorage(value){unavailable=value;}
      export async function put(pathname,data,options){if(unavailable)throw new Error('Storage unavailable');blobs.set(pathname,{data,...options});return {pathname};}
      export async function get(pathname){if(unavailable)throw new Error('Storage unavailable');const blob=blobs.get(pathname);return blob?{statusCode:200,blob,stream:new Response(blob.data).body}:null;}
      export async function list({prefix}){if(unavailable)throw new Error('Storage unavailable');return {blobs:[...blobs.keys()].filter(pathname=>pathname.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false};}
      export async function del(pathname){blobs.delete(pathname);}
    ` };
  },
});

export const { default: quote } = await import('../api/quote.js');
export const { default: discounts } = await import('../api/admin-discounts.js');
export const { default: booking } = await import('../api/booking-requests.js');
export const { default: availability } = await import('../api/availability.js');
export const { default: inviteProfile } = await import('../api/invite-profile.js');
export const { appendBookingRecord, getBookingCalendar } = await import('../_lib/booking-store.js');
export const { appendInviteRecord } = await import('../_lib/invite-store.js');
export const { createSession } = await import('../_lib/security.js');
export const { blobs, failStorage } = await import('test:booking-blob');
export const { approvals } = await import('test:booking-approval');

export function reset() { blobs.clear();failStorage(false);approvals.length=0; }
export const adminCookie = () => `wch_admin=${createSession({ role: 'admin' }, 3600)}`;
export const inviteCookie = (inviteId) => `wch_invite=${createSession({ role: 'invite', inviteId, visitorName: 'Test Guest' }, 3600)}`;
let requestNumber=0;
export async function call(handler, { method='POST', body={}, query={}, cookie='', origin='https://booking.example.test' }={}) {
  const response={code:0,headers:{},body:null,status(code){this.code=code;return this;},setHeader(name,value){this.headers[name]=value;},json(value){this.body=value;return this;},end(value){this.body=value;return this;}};
  await handler({method,body,query,headers:{host:'booking.example.test',origin,cookie,'x-forwarded-for':`test-${++requestNumber}`}},response);
  return response;
}

export const stay = { arrival:'2027-05-17', departure:'2027-05-20', guests:4, dogs:0 };
export const friend = {id:'test-friend',matchType:'phone',target:'5558675309',email:'friend@example.test',guestName:'Private Saved Name',discountType:'percentage',percentage:20,label:'Friends & Family rate',createdAt:'2026-01-01T00:00:00.000Z'};
export async function seedFriend(rule=friend) { await appendBookingRecord({type:'discount_created',discount:rule,createdAt:rule.createdAt}); }
export function bookingBody(overrides={}) { return {name:'Example Guest',email:'friend@example.test',phone:'5558675309',arrival1:stay.arrival,departure1:stay.departure,guests:4,dogs:0,billingAddress:'123 Test Street',billingCity:'Test City',billingState:'GA',billingPostalCode:'30513',guestNames:'Example Other Guest',vehicleCount:1,ageConfirmed:true,primaryGuestStaying:true,privacyAccepted:true,formStartedAt:Date.now()-10000,...overrides}; }
