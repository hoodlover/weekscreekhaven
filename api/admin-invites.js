import { appendInviteRecord, getAccessRecords, getInvites } from '../_lib/invite-store.js';
import { generatePasscode, hashPasscode, json, requireAdmin } from '../_lib/security.js';

function safeText(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function presentInvite(invite) {
  const { hash: _hash, salt: _salt, ...safeInvite } = invite;
  return safeInvite;
}

export default async function handler(request, response) {
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    if (request.method === 'GET') {
      const [invites, access] = await Promise.all([getInvites(), getAccessRecords()]);
      const withActivity = invites.map((invite) => {
        const inviteAccess = access.filter((entry) => entry.inviteId === invite.id);
        return { ...presentInvite(invite), accessCount: inviteAccess.length, lastAccessAt: inviteAccess[0]?.accessedAt || null };
      });
      return json(response, 200, { invites: withActivity, access: access.slice(0, 250) }, { 'Cache-Control': 'no-store' });
    }

    if (request.method === 'POST') {
      const label = safeText(request.body?.label, 80);
      if (label.length < 2) return json(response, 400, { error: 'Add the friend or family name for this invite.' });
      const passcode = generatePasscode();
      const passcodeHash = hashPasscode(passcode);
      const createdAt = new Date().toISOString();
      const expiresAt = request.body?.expiresAt ? new Date(request.body.expiresAt).toISOString() : null;
      const invite = {
        id: crypto.randomUUID(), label, passcode, ...passcodeHash, createdAt, expiresAt,
        notes: safeText(request.body?.notes, 240), maxUses: Math.max(0, Math.min(999, Number(request.body?.maxUses) || 0)),
      };
      await appendInviteRecord({ type: 'created', createdAt, invite });
      return json(response, 201, { invite: presentInvite(invite) });
    }

    if (request.method === 'PATCH') {
      const inviteId = safeText(request.body?.inviteId, 80);
      const invites = await getInvites();
      if (!invites.some((invite) => invite.id === inviteId)) return json(response, 404, { error: 'Invite not found.' });
      const createdAt = new Date().toISOString();
      await appendInviteRecord({ type: 'revoked', createdAt, inviteId });
      return json(response, 200, { ok: true });
    }

    return json(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Invite storage is unavailable. Check the site storage settings.' });
  }
}
