import { appendAccessRecord, getAccessRecords, getInvites } from '../_lib/invite-store.js';
import { INVITE_COOKIE, anonymizeIp, cookieHeader, createSession, json, normalizePasscode, verifyPasscode } from '../_lib/security.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  try {
    const passcode = normalizePasscode(request.body?.passcode);
    const visitorName = String(request.body?.visitorName || '').trim().slice(0, 80);
    if (!passcode || !visitorName) return json(response, 400, { error: 'Enter your name and invite passcode.' });
    const invites = await getInvites();
    let invite = null;
    for (const candidate of invites) {
      if (verifyPasscode(passcode, candidate.salt, candidate.hash)) {
        invite = candidate;
        break;
      }
    }
    const expired = invite?.expiresAt && new Date(invite.expiresAt).getTime() < Date.now();
    let overLimit = false;
    if (invite?.maxUses) {
      const access = await getAccessRecords();
      overLimit = access.filter((entry) => entry.inviteId === invite.id).length >= invite.maxUses;
    }
    if (!invite || invite.revokedAt || expired || overLimit) {
      await wait(400);
      return json(response, 401, { error: 'That invite is not active. Check the code or ask Lance for a fresh invite.' });
    }

    const accessedAt = new Date().toISOString();
    const forwarded = request.headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0].trim();
    await appendAccessRecord({
      id: crypto.randomUUID(), inviteId: invite.id, inviteLabel: invite.label, visitorName,
      accessedAt, ipHash: anonymizeIp(ip), userAgent: String(request.headers['user-agent'] || '').slice(0, 300),
    });
    const maxAge = 7 * 24 * 60 * 60;
    const session = createSession({ role: 'invite', inviteId: invite.id, visitorName }, maxAge);
    return json(response, 200, { ok: true, destination: '/friends-hub.html' }, {
      'Set-Cookie': cookieHeader(INVITE_COOKIE, session, maxAge),
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'The invite service is not configured yet. Please ask Lance to check the site settings.' });
  }
}
