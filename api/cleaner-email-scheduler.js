import { processScheduledCleanerEmails } from '../_lib/cleaner-email-jobs.js';
import { json } from '../_lib/security.js';

export const config = { maxDuration: 300 };

export default async function handler(request, response) {
  if (!process.env.CRON_SECRET || request.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return json(response, 401, { error: 'Scheduled email authorization failed.' });
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
  try {
    // These are explicitly owner-approved times, separate from automatic guest quiet hours.
    return json(response, 200, { ok: true, ...await processScheduledCleanerEmails() }, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error('Scheduled cleaner emails could not be processed.', error);
    return json(response, 503, { error: 'Scheduled cleaner emails could not be processed.' }, { 'Cache-Control': 'no-store' });
  }
}
