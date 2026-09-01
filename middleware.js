import { next, rewrite } from '@vercel/functions';

const INVITE_COOKIE = 'wch_invite';
const ADMIN_COOKIE = 'wch_admin';
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

async function validSession(token, expectedRole) {
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32 || !token) return null;
    const [body, signature] = token.split('.');
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, fromBase64url(signature || ''), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
    return payload.role === expectedRole && payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

export default async function middleware(request) {
  const requestUrl = new URL(request.url);
  const pathname = requestUrl.pathname;
  const hostname = requestUrl.hostname.toLowerCase();
  const publicHosts = new Set(['weekscreekhaven.com', 'www.weekscreekhaven.com']);

  if (hostname === 'owner.weekscreekhaven.com' && pathname === '/') {
    return rewrite(new URL('/admin.html', request.url));
  }
  if (hostname === 'cleaner.weekscreekhaven.com' && pathname === '/') {
    return rewrite(new URL('/cleaner.html', request.url));
  }
  if (publicHosts.has(hostname) && (pathname === '/admin' || pathname === '/admin.html')) {
    return Response.redirect(new URL(`https://owner.weekscreekhaven.com/${requestUrl.search}${requestUrl.hash}`), 307);
  }
  if (publicHosts.has(hostname) && (pathname === '/cleaner' || pathname === '/cleaner.html')) {
    return Response.redirect(new URL(`https://cleaner.weekscreekhaven.com/${requestUrl.search}${requestUrl.hash}`), 307);
  }
  if (pathname === '/' || pathname === '/admin' || pathname === '/admin.html' || pathname === '/cleaner' || pathname === '/cleaner.html') {
    return next();
  }
  const ownerOnly = pathname === '/owner-emergency-handbook' || pathname === '/owner-emergency-handbook.html';
  const adminSession = await validSession(cookieValue(request, ADMIN_COOKIE), 'admin');
  if (adminSession) return next();
  if (ownerOnly) {
    const login = new URL('/admin.html', request.url);
    login.searchParams.set('returnTo', pathname);
    return Response.redirect(login, 302);
  }
  const session = await validSession(cookieValue(request, INVITE_COOKIE), 'invite');
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
  matcher: ['/', '/admin', '/admin.html', '/cleaner', '/cleaner.html', '/friends-hub', '/friends-hub.html', '/welcome-friends', '/welcome-friends.html', '/owner-emergency-handbook', '/owner-emergency-handbook.html'],
};
