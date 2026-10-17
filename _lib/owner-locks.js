import { randomInt, randomUUID } from 'node:crypto';

function safeErrorSource(error) {
  if (typeof error?.stack !== 'string') return [];
  return error.stack.split('\n').slice(1).flatMap(line => {
    const match = line.match(/(?:^|[/(])([^/()]+\.js):(\d+):(\d+)/);
    return match ? [`${match[1]}:${match[2]}`] : [];
  }).slice(0, 2);
}

export function easternInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) throw new Error('Enter a valid Eastern date and time.');
  const target = value.replace('T', ' '), matches = [];
  const format = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
  for (const offset of ['-04:00','-05:00']) {
    const date = new Date(`${value}:00${offset}`);
    if (Number.isFinite(date.getTime()) && format.format(date) === target) matches.push(date.toISOString());
  }
  if (matches.length !== 1) throw new Error('This time is invalid or ambiguous because of daylight saving time. Choose another time.');
  return matches[0];
}
export function newOwnerLock(input, { doors, usedCodes, now = new Date() }) {
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw new Error('Enter a name for this code.');
  const mode = input.mode;
  if (!['permanent','scheduled','once'].includes(mode)) throw new Error('Choose an access type.');
  const doorIds = [...new Set(Array.isArray(input.doorIds) ? input.doorIds : [])];
  if (!doorIds.length || doorIds.some(id => !doors.some(door => door.id === id))) throw new Error('Select valid cabin doors.');
  if (mode === 'once' && doorIds.length !== 1) throw new Error('One successful unlock requires exactly one door.');
  let code = String(input.code || '').trim();
  if (!code) {
    for (let count=0; count<200; count++) { const candidate=String(randomInt(100000,1000000)); if (!usedCodes.has(candidate)) { code=candidate; break; } }
  }
  if (!/^\d{4,8}$/.test(code)) throw new Error('Use a 4–8 digit PIN or leave it blank to generate a six-digit one.');
  if (usedCodes.has(code)) throw new Error('That PIN is already reserved. Choose a different PIN.');
  let startsAt = null, endsAt = null;
  if (mode === 'scheduled') {
    startsAt = easternInput(input.startsAt); endsAt = easternInput(input.endsAt);
    if (Date.parse(endsAt) <= Date.parse(startsAt) || Date.parse(endsAt) <= now.getTime()) throw new Error('The end must be after the start and in the future.');
  }
  return { id: randomUUID(), name, code, mode, doorIds, startsAt, endsAt, createdAt: now.toISOString(), status: 'pending', doors: {} };
}
export async function changeOwnerLockCode(entry, { code, provider, doors, save }) {
  if (entry.mode === 'once') throw new Error('One successful PINs cannot be changed through this integration.');
  if (!entry.pendingCodeChange && entry.status !== 'installed') throw new Error('This code must be installed before its PIN can be changed.');
  if (!entry.pendingCodeChange) {
    if (code === entry.code) throw new Error('Choose a different PIN.');
    entry.pendingCodeChange = { from:entry.code, to:code, updatedDoorIds:[] };
    entry.status = 'updating';
    await save(entry);
  }
  const pending = entry.pendingCodeChange;
  for (const doorId of entry.doorIds) {
    if (pending.updatedDoorIds.includes(doorId)) continue;
    const door = doors.find(item => item.id === doorId);
    const previous = entry.doors[doorId] || {};
    try {
      if (!door || !['installed','failed'].includes(previous.status) || !previous.providerCodeId) throw new Error('A saved lock reference is missing; this door needs owner review.');
      const result = await provider.changeCode({ door, fromCode:pending.from, code:pending.to, providerCodeId:previous.providerCodeId,
        name:entry.name, accessType:entry.mode, startsAt:entry.startsAt, endsAt:entry.endsAt });
      entry.doors[doorId] = { ...previous, status:'installed', providerCodeId:result.providerCodeId, verification:result.verification, failure:undefined };
      pending.updatedDoorIds.push(doorId);
    } catch (error) {
      console.error('Owner lock PIN update failed', { doorId, name:error?.name || 'Error', operation:error?.operation || null, providerCode:error?.providerCode ?? null, source:safeErrorSource(error) });
      entry.doors[doorId] = { ...previous, status:'failed', failure:safeDoorFailureDetails(error) };
    }
    await save(entry);
  }
  if (entry.doorIds.every(id => pending.updatedDoorIds.includes(id))) {
    entry.code = pending.to;
    delete entry.pendingCodeChange;
    entry.status = 'installed';
    entry.updatedAt = new Date().toISOString();
  } else {
    entry.status = 'needs-attention';
  }
  await save(entry);
  return entry;
}

export function confirmOwnerLockDoorAbsent(entry, doorId) {
  if (entry.status !== 'revoking' || entry.mode !== 'permanent' || !entry.doorIds.includes(doorId)
    || entry.doors[doorId]?.status !== 'failed') {
    throw new Error('Confirm absence only for a failed permanent-code removal on an assigned door.');
  }
  const { providerCodeId, ...previous } = entry.doors[doorId];
  entry.doors[doorId] = { ...previous, status:'removed', failure:undefined };
  entry.status = entry.doorIds.every(id => entry.doors[id]?.status === 'removed') ? 'revoked' : 'revoking';
  entry.updatedAt = new Date().toISOString();
  return entry;
}

export async function applyOwnerLock(entry, { provider, doors, save, revoke = false }) {
  if (entry.pendingCodeChange && !revoke) return changeOwnerLockCode(entry, { code:entry.pendingCodeChange.to, provider, doors, save });
  if (entry.pendingCodeChange && revoke) throw new Error('This PIN change needs attention. Retry it before deleting access.');
  if (entry.mode === 'once') {
    if (revoke) throw new Error('Use KK Home to clear an unused one-time code. It cannot be safely revoked through this integration yet.');
    if (entry.attemptedAt) return entry; // Never rearm a potentially consumed one-time code.
    entry.attemptedAt = new Date().toISOString(); entry.status = 'unconfirmed'; await save(entry);
    try {
      const result = await provider.installOneTime({ door: doors.find(d => d.id === entry.doorIds[0]), code: entry.code });
      entry.status = result.status; entry.verification = result.verification; entry.providerExpiresAt = result.endsAt || null; entry.commandSent = Boolean(result.commandSent);
    } catch (error) {
      entry.status = 'unconfirmed';
      entry.failure = { operation:error.operation || null, providerCode:error.providerCode || null,
        reason:error.message === 'This door already has a one-time code. Use or clear it in KK Home first.' ? error.message : 'The one-time request was not confirmed by KK Home.' };
    }
    await save(entry); return entry;
  }
  if (!revoke && ['revoked','revoking'].includes(entry.status)) throw new Error('This code was revoked. Create a new code instead.');
  if (!revoke && entry.mode === 'scheduled' && Date.parse(entry.endsAt) <= Date.now()) throw new Error('This scheduled window has ended.');
  entry.status = revoke ? 'revoking' : 'updating'; await save(entry);
  for (const doorId of entry.doorIds) {
    const door = doors.find(d => d.id === doorId);
    const previous = entry.doors[doorId] || {};
    try {
      if (!door) throw new Error('Door configuration changed.');
      if (revoke) {
        let ref = previous.providerCodeId || (await provider.findCode({ door, code: entry.code }))?.providerCodeId;
        if (!ref && previous.status === 'failed') throw new Error('An uncertain insertion needs owner review before removal can be confirmed.');
        if (ref) {
          try { await provider.removeCode({ door, code: entry.code, providerCodeId: ref }); }
          catch (error) {
            if (!previous.providerCodeId || error?.operation !== 'key-list-verify-reference') throw error;
            const current = await provider.findCode({ door, code: entry.code });
            if (!current?.providerCodeId || current.providerCodeId === ref) throw error;
            ref = current.providerCodeId;
            await provider.removeCode({ door, code: entry.code, providerCodeId: ref });
          }
        }
        entry.doors[doorId] = { ...previous, status: 'removed' };
      } else {
        const result = await provider.installCode({ door, code: entry.code, name: entry.name, accessType: entry.mode,
          startsAt: entry.startsAt, endsAt: entry.endsAt, providerCodeId: previous.providerCodeId });
        entry.doors[doorId] = { status: result.status, providerCodeId: result.providerCodeId, verification: result.verification };
      }
    } catch (error) {
      console.error(`Owner lock ${revoke?'removal':'installation'} failed`, { doorId, name:error?.name || 'Error', operation:error?.operation || null, providerCode:error?.providerCode ?? null, source:safeErrorSource(error) });
      entry.doors[doorId] = { ...previous, status:'failed', failure:safeDoorFailureDetails(error), ...(error.providerCodeId ? {providerCodeId:error.providerCodeId} : {}) };
    }
    await save(entry);
  }
  entry.status = entry.doorIds.every(id => entry.doors[id].status === (revoke ? 'removed' : 'installed')) ? (revoke ? 'revoked' : 'installed') : (revoke ? 'revoking' : 'needs-attention');
  entry.updatedAt = new Date().toISOString(); await save(entry); return entry;
}

function safeDoorFailureDetails(error) {
  const message = String(error?.message || '');
  const reason = /^KK Home did not verify/.test(message)
    ? 'KK Home did not confirm the change. Check this lock in the KK Home app before retrying.'
    : /^Saved code entry/.test(message)
      ? 'The saved lock entry changed. Review this door in KK Home before retrying.'
      : /^The saved KK Home code reference/.test(message)
        ? 'The saved lock reference is missing or invalid. Review this door in KK Home.'
        : /^KK Home returned an (?:unreadable|unexpected) response/.test(message)
          ? 'KK Home returned an unexpected response. Check this door in the KK Home app before retrying.'
          : 'KK Home could not confirm this door. Check it in the KK Home app before retrying.';
  return { reason, ...(error?.operation ? { operation:String(error.operation).slice(0,80) } : {}), ...(Number.isInteger(error?.providerCode) ? { providerCode:error.providerCode } : {}) };
}
