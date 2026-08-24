import { ADMIN_COOKIE, cookieHeader, createSession, json, verifyAdminPassword } from '../_lib/security.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
  try {
    const ok = verifyAdminPassword(request.body?.password);
    if (!ok) {
      await wait(350);
      return json(response, 401, { error: 'That admin password is not correct.' });
    }
    const maxAge = 8 * 60 * 60;
    return json(response, 200, { ok: true }, {
      'Set-Cookie': cookieHeader(ADMIN_COOKIE, createSession({ role: 'admin' }, maxAge), maxAge),
      'Cache-Control': 'no-store',
    });
  } catch (error) {
    return json(response, 503, { error: error.message });
  }
}
