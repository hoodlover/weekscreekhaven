import crypto from 'node:crypto';
import { get, list, put } from '@vercel/blob';
import { decryptRecord, encryptRecord } from './security.js';
import { appendCleanerRecord } from './cleaner-store.js';
import { emailCapabilities, escapeEmailHtml, normalizeEmailCc, sendEmail, validateEmailAddress } from './email.js';

const PREFIX = 'secure-cleaner/email-jobs/';
export const CLEANER_EMAIL_TIME_ZONE = 'America/New_York';
const token = () => process.env.INVITE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const jobPath = id => {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw error('This scheduled email ID is invalid.');
  return `${PREFIX}${id}.enc`;
};
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLEANER_EMAIL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function localMinute(date) {
  const parts = Object.fromEntries(dateFormatter.formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// Resolve the owner's Eastern wall time on the server, independent of device/server zone.
// Reject DST gaps and overlaps rather than silently choosing the wrong time.
export function cleanerEmailSendAt(local, timeZone = CLEANER_EMAIL_TIME_ZONE) {
  if (timeZone !== CLEANER_EMAIL_TIME_ZONE) throw error('Choose a send time in Eastern time (America/New_York).');
  if (typeof local !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw error('Choose a complete send date and time.');
  const wall = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(wall)) throw error('Choose a valid send date and time.');
  const matches = [];
  for (const hours of [4, 5]) {
    const candidate = new Date(wall + hours * 3600000);
    if (localMinute(candidate) === local) matches.push(candidate.toISOString());
  }
  if (!matches.length) throw error('That Eastern time does not exist. Choose another time, outside the daylight-saving clock change.');
  if (matches.length > 1) throw error('That Eastern time happens twice during the daylight-saving clock change. Choose a time after 2:00 AM.');
  return matches[0];
}

export function cleanerEmailHtml(subject, body) {
  const htmlBody = escapeEmailHtml(body.replace(/\n+(?:Thank you,\s*\n+)?Heather\s*&\s*Lance(?:\s*\n+Weeks Creek Haven)?\s*$/i, '').trim()).replace(/\n/g, '<br>');
  return `<div style="font-family:Arial,sans-serif;color:#332820;line-height:1.65;max-width:640px"><div style="padding:22px;background:#183c2d;color:#fff"><div style="color:#e5b67e;font-size:12px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase">Weeks Creek Haven · Cabin Care</div><h1 style="margin:6px 0 0;color:#fff;font-family:Georgia,serif">${escapeEmailHtml(subject)}</h1></div><div style="padding:24px;background:#fffdf8">${htmlBody}</div><div style="padding:16px 24px;background:#f4eee0;color:#76695e;font-size:12px">Weeks Creek Haven · Blue Ridge, Georgia</div></div>`;
}

async function readJob(id) {
  const value = await get(jobPath(id), { token: token(), access: 'private', useCache: false });
  if (!value || value.statusCode === 404) return null;
  if (value.statusCode !== 200 || !value.blob?.etag) throw error('The scheduled email could not be read safely.', 503);
  const job = decryptRecord(await new Response(value.stream).text());
  if (!job || job.id !== id) throw error('The scheduled email record is invalid.', 503);
  return { job, etag: value.blob.etag };
}

async function writeJob(job, etag) {
  if (!token()) throw error('Cleaner storage is not configured.', 503);
  return put(jobPath(job.id), encryptRecord(job), {
    token: token(), access: 'private', addRandomSuffix: false, allowOverwrite: Boolean(etag),
    ...(etag ? { ifMatch: etag } : {}), contentType: 'text/plain', cacheControlMaxAge: 60,
  });
}

function viewJob(job, now = new Date()) {
  const { fingerprint, attemptId, ...view } = job;
  if (job.status === 'sending' && Number(now) - Date.parse(job.attemptedAt) >= 10 * 60000) {
    view.status = 'attention';
    view.statusNote = 'Delivery could not be confirmed. Check the provider before sending another copy; this email will not be retried automatically.';
  }
  return view;
}

export async function listCleanerEmailJobs(now = new Date()) {
  let cursor; const jobs = [];
  do {
    const page = await list({ prefix: PREFIX, token: token(), cursor, limit: 1000 });
    // Bounded parallel reads keep older history from serially delaying due work.
    // A damaged/unavailable record must not block every other email or the owner view.
    for (let offset = 0; offset < page.blobs.length; offset += 20) {
      const batch = await Promise.all(page.blobs.slice(offset, offset + 20).map(async blob => {
        const id = blob.pathname.slice(PREFIX.length, -4);
        try {
          const found = await readJob(id);
          return found ? viewJob(found.job, now) : null;
        } catch {
          return { id, profileId: '', subject: 'Scheduled email record needs attention', body: '', to: '', cc: [], sendAt: '', status: 'attention', statusNote: 'This record could not be read safely. No new send was attempted for it. Contact the owner before creating another copy.' };
        }
      }));
      jobs.push(...batch.filter(Boolean));
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return jobs.sort((a, b) => a.sendAt.localeCompare(b.sendAt));
}

export async function scheduleCleanerEmail(input, now = new Date()) {
  const id = input.operationId; jobPath(id);
  const to = validateEmailAddress(input.to, 'Cleaner email');
  const cc = normalizeEmailCc(input.cc, to);
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (subject.length < 5 || subject.length > 160 || /[\r\n]/.test(subject) || body.length < 20 || body.length > 5000) throw error('Use a subject of 5–160 characters and a message of 20–5,000 characters.');
  const sendAt = cleanerEmailSendAt(input.sendLocal, input.timeZone);
  const payload = { id, profileId: input.profileId, to, toName: input.toName, cc, subject, body,
    templateId: input.templateId || '', bookingId: input.bookingId || '', sendAt,
    sendLocal: input.sendLocal, timeZone: CLEANER_EMAIL_TIME_ZONE };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const existing = await readJob(id);
  if (existing) {
    if (existing.job.fingerprint !== fingerprint) throw error('This request ID already belongs to a different email. Refresh and review the new draft.', 409);
    return viewJob(existing.job, now);
  }
  if (Date.parse(sendAt) <= Number(now)) throw error('Choose a future send time.');
  if (Date.parse(sendAt) > Number(now) + 366 * 86400000) throw error('Schedule this email no more than one year ahead.');
  if (!process.env.CRON_SECRET) throw error('Scheduled email processing is not configured yet. Nothing was scheduled.', 503);
  const capabilities = emailCapabilities();
  if (!capabilities.configured) throw error('Connect transactional email before scheduling.', 503);
  if (cc.length && !capabilities.cc) throw error('CC requires the Resend email connection. Nothing was scheduled.');
  const job = { ...payload, fingerprint, status: 'queued', createdAt: now.toISOString() };
  try { await writeJob(job); }
  catch (writeError) {
    // A timed-out create may have committed. Reuse it, never create a new job ID.
    const saved = await readJob(id);
    if (saved?.job.fingerprint === fingerprint) return viewJob(saved.job, now);
    if (saved) throw error('This request ID already belongs to a different email.', 409);
    throw writeError;
  }
  return viewJob(job, now);
}

export async function cancelCleanerEmail(id, now = new Date()) {
  const found = await readJob(id);
  if (!found) throw error('This scheduled email could not be found.', 404);
  if (found.job.status === 'cancelled') return viewJob(found.job, now);
  if (found.job.status !== 'queued') throw error('This email has already started sending and cannot be cancelled. Check its status before sending another copy.', 409);
  const job = { ...found.job, status: 'cancelled', cancelledAt: now.toISOString() };
  try { await writeJob(job, found.etag); }
  catch {
    const current = await readJob(id);
    if (current?.job.status === 'cancelled') return viewJob(current.job, now);
    throw error('The email changed while cancellation was requested. Refresh its status; it may already be sending.', 409);
  }
  return viewJob(job, now);
}

export async function processScheduledCleanerEmails(now = new Date()) {
  const due = (await listCleanerEmailJobs(now)).filter(job => job.status === 'queued' && Date.parse(job.sendAt) <= Number(now)).slice(0, 10);
  const summary = { checked: due.length, sent: 0, attention: 0 };
  for (const candidate of due) {
    const found = await readJob(candidate.id);
    if (!found || found.job.status !== 'queued') continue;
    const capabilities = emailCapabilities();
    if (!capabilities.configured || (found.job.cc.length && !capabilities.cc)) {
      const job = { ...found.job, status: 'attention', statusNote: 'The required email connection is unavailable. No send was attempted. Review before scheduling a new copy.' };
      try { await writeJob(job, found.etag); summary.attention++; } catch { /* Another invocation may own it. */ }
      continue;
    }
    const claimed = { ...found.job, status: 'sending', attemptedAt: now.toISOString(), attemptId: crypto.randomUUID() };
    let claim;
    try { claim = await writeJob(claimed, found.etag); }
    catch { continue; } // Even a timed-out CAS may have committed. Never send without confirmed ownership.
    if (!claim.etag) continue;
    let finished;
    try {
      const result = await sendEmail({ to: claimed.to, toName: claimed.toName, cc: claimed.cc, subject: claimed.subject,
        text: claimed.body, html: cleanerEmailHtml(claimed.subject, claimed.body), idempotencyKey: `cleaner-scheduled-${claimed.id}`, requestTimeoutMs: 15000 });
      const providerMessageId = result?.provider === 'resend' ? result.id : result?.success === true ? result.emailId : '';
      if (typeof providerMessageId !== 'string' || !providerMessageId) throw new Error('Provider acceptance was not confirmed.');
      finished = { ...claimed, status: 'sent', sentAt: new Date().toISOString(), provider: result.provider, providerMessageId };
      summary.sent++;
    } catch {
      finished = { ...claimed, status: 'attention', statusNote: 'Delivery could not be confirmed. Check the email provider before sending another copy; this email will not be retried automatically.' };
      summary.attention++;
    }
    // A failure after the provider accepted the message must NEVER reset this claim.
    // Resend keys expire after 24 hours; the permanent job is the duplicate-send guard.
    try { await writeJob(finished, claim.etag); }
    catch { summary.attention++; }
    if(finished.status==='sent' && finished.bookingId){
      try { await appendCleanerRecord({type:'assignment',bookingId:finished.bookingId,createdAt:finished.sentAt,changes:{cleanerEmailSentAt:finished.sentAt,cleanerEmailTemplateId:finished.templateId}}); }
      catch { /* Provider acceptance is already durable; never resend to repair a dashboard marker. */ }
    }
  }
  return summary;
}
