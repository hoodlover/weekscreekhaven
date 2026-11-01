// Temporary, reversible pause requested by the owner. Keep records and lock
// reconciliation intact. Reopening the app does NOT resume old email jobs.
export const CLEANER_APP_PAUSED = true;
export const CLEANER_REMINDERS_RESUME_AFTER = null;
export const OWNER_HOST = 'owner.weekscreekhaven.com';
export const CLEANER_HOST = 'cleaner.weekscreekhaven.com';
export const CLEANER_PAUSE_MESSAGE = 'The Cleaner Hub is temporarily offline. Saved records are retained. Please contact Heather or Lance directly.';

export function requestHostname(request) {
  const host = typeof request.headers?.get === 'function'
    ? request.headers.get('host') || new URL(request.url).host
    : request.headers?.host || '';
  return String(host).toLowerCase().split(':')[0];
}
export function ownerCleanerAccess(request, isOwner) {
  return Boolean(isOwner) && requestHostname(request) === OWNER_HOST;
}
export function cleanerRequestPaused(request, isOwner = false) {
  return CLEANER_APP_PAUSED && !ownerCleanerAccess(request, isOwner);
}
export function cleanerRemindersPaused(paused = CLEANER_APP_PAUSED, resumeAfter = CLEANER_REMINDERS_RESUME_AFTER) {
  return paused || !Number.isFinite(Date.parse(resumeAfter || ''));
}
// Resumption requires an explicit future rollout cutoff. Old queued jobs and
// already-due offer reminders remain held, not automatically replayed.
export function cleanerReminderEligible(dueAt, paused = CLEANER_APP_PAUSED, resumeAfter = CLEANER_REMINDERS_RESUME_AFTER) {
  return !cleanerRemindersPaused(paused, resumeAfter)
    && Number.isFinite(Date.parse(dueAt || '')) && Date.parse(dueAt) >= Date.parse(resumeAfter);
}
export const CLEANER_PAUSED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Cleaner Hub paused | Weeks Creek Haven</title><style>body{margin:0;background:#f7f0e4;color:#183c2d;font:18px/1.6 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center}main{max-width:34rem;padding:2rem}h1{font:600 2.4rem Georgia,serif}p{color:#554a3e}small{font-size:.85rem}</style></head><body><main><small>WEEKS CREEK HAVEN</small><h1>Cleaner Hub temporarily offline</h1><p>${CLEANER_PAUSE_MESSAGE}</p></main></body></html>`;
