import { getInvites } from '../_lib/invite-store.js';
import { json, requireInvite } from '../_lib/security.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  const session = requireInvite(request);
  if (!session) return json(response, 401, { error: 'Please use your invite to sign in.' });
  try {
    const invite = (await getInvites()).find((item) => item.id === session.inviteId);
    const expired = invite?.expiresAt && new Date(invite.expiresAt).getTime() < Date.now();
    if (!invite || invite.revokedAt || expired) return json(response, 403, { error: 'This invite is no longer active.' });
    return json(response, 200, {
      visitorName: session.visitorName,
      inviteLabel: invite.label,
      welcomeMessage: invite.welcomeMessage || '',
      photos: (invite.photos || []).map((photo) => ({ id: photo.id })),
    }, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'Your welcome page is temporarily unavailable.' });
  }
}
