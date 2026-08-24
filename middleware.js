import { next } from '@vercel/functions';

const COOKIE_NAME = 'wch_invite';
const encoder = new TextEncoder();

function cookieValue(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function fromBase64url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function validInviteSession(token) {
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32 || !token) return null;
    const [body, signature] = token.split('.');
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64url(signature || ''), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
    return payload.role === 'invite' && payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

export default async function middleware(request) {
  const session = await validInviteSession(cookieValue(request, COOKIE_NAME));
  if (session) {
    const statusUrl = new URL('/api/invite-status', request.url);
    statusUrl.searchParams.set('inviteId', session.inviteId);
    try {
      const status = await fetch(statusUrl, { headers: { 'x-wch-middleware-secret': process.env.SESSION_SECRET }, cache: 'no-store' });
      if (status.ok && (await status.json()).active) return next();
    } catch {
      // Fail closed when invite state cannot be confirmed.
    }
  }
  const login = new URL('/important-info.html', request.url);
  login.searchParams.set('returnTo', new URL(request.url).pathname);
  return Response.redirect(login, 302);
}

export const config = {
  matcher: ['/friends-hub', '/friends-hub.html'],
};
