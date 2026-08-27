import { getInvites } from '../_lib/invite-store.js';
import { cookieHeader, createSession, INVITE_COOKIE, requireAdmin } from '../_lib/security.js';

export default async function handler(request, response) {
  if (!requireAdmin(request)) return response.redirect(302, '/admin.html');
  if (request.method !== 'GET') return response.status(405).send('Method not allowed.');
  try {
    const invite = (await getInvites()).find((item) => item.id === String(request.query?.inviteId || ''));
    if (!invite) return response.status(404).send('Invite not found.');
    const maxAge = 60 * 60;
    response.setHeader('Set-Cookie', cookieHeader(INVITE_COOKIE, createSession({ role: 'invite', inviteId: invite.id, visitorName: 'Lance & Heather · owner preview' }, maxAge), maxAge));
    response.setHeader('Cache-Control', 'no-store');
    return response.redirect(302, '/welcome-friends.html?ownerPreview=1');
  } catch (error) {
    console.error(error);
    return response.status(503).send('The welcome-page preview is temporarily unavailable.');
  }
}
