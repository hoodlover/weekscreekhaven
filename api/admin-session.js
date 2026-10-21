import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, cookieHeader, createSession, json, requireAdmin, sameOriginRequest, sharedAdminCookieDomain } from '../_lib/security.js';

export default function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  if (!sameOriginRequest(request)) return json(response, 403, { error: 'Open the owner session from this website.' });
  if (!requireAdmin(request)) return json(response, 401, { error: 'Please sign in as the owner.' }, { 'Cache-Control': 'no-store' });
  const domain = sharedAdminCookieDomain(request);
  return json(response, 200, { ok: true }, {
    'Set-Cookie': [
      ...(domain ? [cookieHeader(ADMIN_COOKIE, '', -1)] : []),
      cookieHeader(ADMIN_COOKIE, createSession({ role: 'admin' }, ADMIN_SESSION_SECONDS), ADMIN_SESSION_SECONDS, { domain }),
    ],
    'Cache-Control': 'private, no-store',
  });
}
