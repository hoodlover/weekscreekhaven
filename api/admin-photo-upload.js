import { getInvites, uploadInvitePhoto } from '../_lib/invite-store.js';
import { json, requireAdmin } from '../_lib/security.js';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BYTES = 3 * 1024 * 1024;

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the site owner.' });
  try {
    const inviteId = String(request.body?.inviteId || '').trim();
    const contentType = String(request.body?.contentType || '').toLowerCase();
    const data = String(request.body?.data || '');
    if (!ALLOWED_TYPES.has(contentType)) return json(response, 400, { error: 'Use a JPG, PNG, or WebP photo.' });
    const invites = await getInvites();
    const invite = invites.find((item) => item.id === inviteId);
    if (!invite) return json(response, 404, { error: 'Invite not found.' });
    if ((invite.photos || []).length >= 3) return json(response, 400, { error: 'This invite already has three photos.' });
    const match = data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json(response, 400, { error: 'That photo could not be read.' });
    if (match[1] !== contentType) return json(response, 400, { error: 'The photo type does not match its contents.' });
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > MAX_BYTES) return json(response, 400, { error: 'Keep each photo under 3 MB.' });
    const photo = await uploadInvitePhoto(inviteId, buffer, contentType);
    return json(response, 201, { photo: { id: photo.id, createdAt: photo.createdAt } });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: 'The photo could not be uploaded. Check the site storage settings.' });
  }
}
