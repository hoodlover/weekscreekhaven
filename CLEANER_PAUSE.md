# Temporary Cleaner Hub pause

Paused at the owner's request on November 1, 2026. This does not delete data or
change existing physical door codes. The owner can still open Cleaner Hub from
the Owner Command Center to review records and manage cleaner access.

- `_lib/cleaner-pause.js` is the deployment policy. Cleaner UI, login, Hub and
  photo APIs are unavailable to cleaner sessions, including cached installations.
- Authenticated owner controls are available only at
  `https://owner.weekscreekhaven.com/cleaner.html`.
- Cleaner email cron is removed; both scheduled-email processing and service-offer
  reminders return before reading storage. Existing jobs and records remain saved.
- Calendar sync, hourly guest jobs, guest tip payments, owner locks and the cleaner
  lock reconciliation cron are unchanged. Do not disable these to pause the UI.
- Existing offline installations may retain the old screen until reconnecting,
  but cannot read/write live cleaner data. Online navigation shows the pause page.

## Reopen only on the owner's request

1. Review the current requested scope and retained jobs/access with the owner.
2. Set `CLEANER_APP_PAUSED` to false to reopen the UI. This alone does not restart
   reminders. Do not change `enabled` on cleaner profiles to control this pause:
   profile state also governs physical lock access.
3. For a separately approved reminder restart, set
   `CLEANER_REMINDERS_RESUME_AFTER` to the actual restart instant (ISO UTC), restore
   the cleaner email cron, and verify with synthetic tests. Times before that
   cutoff are permanently held by the processor. Review and explicitly schedule
   a new copy if an old message is still relevant. Never backdate the cutoff to
   release a backlog. Service-offer reminder due times also respect the cutoff.
4. Verify cleaner/owner isolation, cached clients, and unaffected guest/calendar/
   door-code flows before deploying. Retain the owner-domain management links.

No production records need editing or deletion for this pause or its reversal.
