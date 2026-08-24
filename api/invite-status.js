import { getInvites } from '../_lib/invite-store.js';
import { json } from '../_lib/security.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return json(response, 405, { active: false });
  if (!process.env.SESSION_SECRET || request.headers['x-wch-middleware-secret'] !== process.env.SESSION_SECRET) {
    return json(response, 401, { active: false });
  }
  try {
    const invite = (await getInvites()).find((item) => item.id === request.query?.inviteId);
    const expired = invite?.expiresAt && new Date(invite.expiresAt).getTime() < Date.now();
    return json(response, 200, { active: Boolean(invite && !invite.revokedAt && !expired) }, { 'Cache-Control': 'no-store' });
  } catch {
    return json(response, 503, { active: false });
  }
}
