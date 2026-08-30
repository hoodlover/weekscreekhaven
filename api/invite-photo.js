import { getInvitePhoto, getInvites } from '../_lib/invite-store.js';
import { requireAdmin, requireInvite } from '../_lib/security.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return response.status(405).end();
  const admin = requireAdmin(request);
  const session = requireInvite(request);
  if (!admin && !session) return response.status(401).end();
  try {
    const photoId = String(request.query?.photoId || '');
    const invites = await getInvites();
    const invite = invites.find((item) => (item.photos || []).some((photo) => photo.id === photoId));
    if (!invite || (!admin && (invite.archivedAt || invite.revokedAt || session.inviteId !== invite.id))) return response.status(404).end();
    const photo = invite.photos.find((item) => item.id === photoId);
    const result = await getInvitePhoto(photo.pathname);
    if (!result || result.statusCode !== 200) return response.status(404).end();
    const body = Buffer.from(await new Response(result.stream).arrayBuffer());
    response.setHeader('Content-Type', result.blob.contentType || photo.contentType || 'image/jpeg');
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.status(200).end(body);
  } catch (error) {
    console.error(error);
    return response.status(503).end();
  }
}
