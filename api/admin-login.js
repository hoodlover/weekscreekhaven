import { ADMIN_COOKIE, cookieHeader, createSession, enforceRateLimit, json, rateLimitJson, sameOriginRequest, sharedAdminCookieDomain, verifyAdminPassword } from '../_lib/security.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  if (!sameOriginRequest(request)) return json(response, 403, { error: 'Open the owner sign-in from this website.' });
  const rate = enforceRateLimit(request, 'admin-login', 5, 15 * 60 * 1000);
  if (!rate.allowed) return rateLimitJson(response, rate);
  try {
    const ok = verifyAdminPassword(request.body?.password);
    if (!ok) {
      await wait(350);
      return json(response, 401, { error: 'That admin password is not correct.' });
    }
    const maxAge = 8 * 60 * 60;
    return json(response, 200, { ok: true }, {
      'Set-Cookie': cookieHeader(ADMIN_COOKIE, createSession({ role: 'admin' }, maxAge), maxAge, { domain:sharedAdminCookieDomain(request) }),
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    return json(response, 503, { error: error.message });
  }
}
