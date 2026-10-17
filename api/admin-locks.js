import { ownerLockEntries, saveOwnerLock, withOwnerLockLease } from '../_lib/owner-lock-store.js';
import { applyOwnerLock, changeOwnerLockCode, newOwnerLock } from '../_lib/owner-locks.js';
import { configuredDoors } from '../_lib/lock-service.js';
import { createKKHomeLockProvider } from '../_lib/lock-providers/kkhome.js';
import { getBookingRequests } from '../_lib/booking-store.js';
import { getCleanerState } from '../_lib/cleaner-store.js';
import { cleanerReservedCodes } from '../_lib/cleaner-profiles.js';
import { json, requireAdmin, sameOriginRequest } from '../_lib/security.js';

export const config = { maxDuration: 60 };
const visible = entry => {
  const { pendingCodeChange, ...safeEntry } = entry;
  return { ...safeEntry, ...(pendingCodeChange ? { pinChangePending:true } : {}), doors:Object.fromEntries(Object.entries(entry.doors).map(([id,value]) => [id,{status:value.status,...(value.failure?.reason?{failure:{reason:value.failure.reason}}:{})}])) };
};
export default async function handler(request,response) {
  response.setHeader('Cache-Control','private, no-store');
  try {
    if (!requireAdmin(request)) return json(response,401,{error:'Owner sign-in required.'});
    const doors = configuredDoors();
    if (request.method === 'GET') return json(response,200,{entries:(await ownerLockEntries()).map(visible),doors:doors.map(({id,name})=>({id,name}))});
    if (request.method !== 'POST') return json(response,405,{error:'Use GET or POST.'});
    if (!sameOriginRequest(request)) return json(response,403,{error:'Submit lock changes from the owner site.'});
    if (process.env.LOCK_PROVIDER !== 'kkhome' || process.env.KKHOME_LIVE_ENABLED !== 'true') return json(response,409,{error:'KK Home automation is not enabled.'});
    const result = await withOwnerLockLease(async () => {
      const entries = await ownerLockEntries(); const action = request.body?.action;
      const provider = createKKHomeLockProvider(process.env,{fetchImpl:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)})});
      let entry;
      if (action === 'create') {
        const operationId = String(request.body.operationId || '');
        if (!/^[a-zA-Z0-9-]{8,80}$/.test(operationId)) throw new Error('Refresh the form and try again.');
        const existing = entries.find(item => item.operationId === operationId); if (existing) return existing;
        const [bookings,cleaner] = await Promise.all([getBookingRequests(),getCleanerState()]);
        const usedCodes = new Set([...entries.map(e=>e.code),...bookings.flatMap(b=>[b.doorCode,...(b.retiredDoorCodes||[])]),...cleaner.cleanerProfiles.flatMap(cleanerReservedCodes)].filter(Boolean).map(String));
        entry = {...newOwnerLock(request.body,{doors,usedCodes}),operationId};
        // Refuse to take over any existing unmanaged lock code with the same PIN.
        for (const id of entry.doorIds) if (await provider.findCode({door:doors.find(d=>d.id===id),code:entry.code})) throw new Error('This PIN already exists on a selected lock. Choose another PIN.');
        await saveOwnerLock(entry);
      } else if (action === 'edit') {
        entry = entries.find(e=>e.id===request.body?.id); if (!entry) throw new Error('Access code not found.');
        const code = request.body?.code;
        if (typeof code !== 'string' || !/^\d{4,8}$/.test(code)) throw new Error('Use a 4–8 digit PIN.');
        if (entry.pendingCodeChange) throw new Error('This PIN change needs attention. Retry it before starting another change.');
        const [bookings,cleaner] = await Promise.all([getBookingRequests(),getCleanerState()]);
        const usedCodes = new Set([...entries.filter(item=>item.id!==entry.id).map(item=>item.code),
          ...bookings.flatMap(b=>[b.doorCode,...(b.retiredDoorCodes||[])]),...cleaner.cleanerProfiles.flatMap(cleanerReservedCodes)]
          .filter(Boolean).map(String));
        if (usedCodes.has(code)) throw new Error('This PIN is already reserved. Choose a different PIN.');
        if (entry.mode !== 'once') for (const id of entry.doorIds) {
          if (await provider.findCode({door:doors.find(item=>item.id===id),code})) throw new Error('This PIN already exists on a selected lock. Choose another PIN.');
        }
        return changeOwnerLockCode(entry,{code,provider,doors,save:saveOwnerLock});
      } else {
        entry = entries.find(e=>e.id===request.body?.id); if (!entry) throw new Error('Access code not found.');
        if (!['retry','revoke','check'].includes(action)) throw new Error('Unknown lock action.');
        if (action === 'check' && entry.mode === 'once') {
          const status = await provider.inspectOneTime({door:doors.find(d=>d.id===entry.doorIds[0]),code:entry.code});
          entry.status = status.matches ? 'installed' : 'not-active'; entry.inspection = status; await saveOwnerLock(entry); return entry;
        }
      }
      return applyOwnerLock(entry,{provider,doors,save:saveOwnerLock,revoke:action==='revoke'});
    });
    return json(response,200,{entry:visible(result)});
  } catch(error) {
    console.error('Owner lock API failure', { name:error?.name || 'Error', operation:error?.operation || null });
    const raw=String(error.message||'');
    const safe = /^(Enter|Choose|Select|One successful|Use |That PIN|This PIN|This time|This code|This scheduled|The end|Refresh|Access code|Unknown lock|Another lock|KK Home returned an (?:unreadable|unexpected) response)/.test(raw);
    return json(response,409,{error:safe?raw:'The lock update could not be confirmed. Refresh the list before trying again.',
      ...(error.operation ? {operation:error.operation,providerCode:error.providerCode} : {})});
  }
}
