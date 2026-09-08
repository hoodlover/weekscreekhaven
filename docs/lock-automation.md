# Door-code automation

Weeks Creek Haven keeps lock access behind a provider-neutral service. The booking system decides which guest, code, and stay window apply; a provider adapter is responsible only for installing or removing that code on every configured door.

## Safety defaults

- `LOCK_PROVIDER` defaults to `manual`. This preserves the current KK Home workflow and never claims a physical lock was changed.
- `LOCK_PROVIDER=simulated` is for local and preview testing only. It is blocked automatically when `VERCEL_ENV=production`.
- A booking is marked installed only after every configured door reports success.
- A partial result leaves `doorCodeInstalledAt` empty, so the guest cannot receive or view the code.
- Owner Bookings remains the source of truth for per-door results and manual confirmations.

## Configuration

The configured cabin doors and KK Home ESNs are:

```json
[
  { "id": "basement", "name": "Basement door", "deviceId": "V273253812525" },
  { "id": "deck", "name": "Deck door", "deviceId": "V273253812458" },
  { "id": "front", "name": "Front door", "deviceId": "V273253812530" }
]
```

Store that JSON as `LOCK_DOORS_JSON`. Device credentials and API secrets must remain server-side environment variables and must never be returned to the browser or stored in booking records.

## KK Home provider

The `kkhome` adapter uses the same remote cloud connection as the KK Home phone app. It creates a duration-limited PIN, reads the lock's key list to verify the PIN and its exact access window, saves the returned key number, and later removes that exact key and verifies it is gone.

KK Home represents local clock fields as UTC-shaped timestamps. The adapter converts each endpoint through `America/New_York`, including the offset on that date, before encoding it. Sending ordinary UTC epoch seconds directly produces a four- or five-hour error in the app.

Lock commands and the app's saved code list are separate operations. The adapter saves the code metadata after an accepted command and checks that the resulting cloud entry contains the expected PIN and local schedule. Its results explicitly identify this as `verification: cloud-record`; this is not a physical keypad or offline-expiration test. Removal likewise checks the saved PIN and resolved door before removing the exact slot and its cloud entry.

References include the device, slot, and a PIN fingerprint. Failed metadata saves retain that reference for safe retries. An unknown hidden entry with the same window stops automatic insertion for owner review instead of creating another code. Old manually installed codes remain owner-managed, and the scheduler does not install codes for past stays.

The owner-only `/api/admin-lock-test` endpoint is limited to the exact temporary PIN, door set, and maximum one-hour window in `KKHOME_TEST_JSON`. It does not read or write bookings. Remove that environment variable after acceptance testing. `/api/admin-lock-status` performs only sign-in and device-list checks.

The owner-only `/api/admin-lock-booking-test` exercises the production booking lock service using an in-memory fixture, without booking storage or guest communications. It requires `KKHOME_BOOKING_TEST_JSON` with `id`, six-digit `code`, `arrival`, `departure`, and `expiresAt` within the next hour. The future access window must end within three days and last at most two days. POST `{testId, action:"install"}`; save the returned `doors` as `references` for retry and `{testId, action:"remove", references}` cleanup. Removal remains available for 24 hours after fixture expiry. Remove the environment variable and redeploy after testing. Never run the email scheduler as an acceptance test.

September 8, 2026 UTC acceptance: the real booking service installed and verified one temporary PIN on basement, deck, and front doors for September 8 at 3:45 PM through September 9 at 11:15 AM Eastern. A retry reused all three provider references. Removal verified absence on all three doors. These are cloud-record checks; physical keypad activation and expiration still require an on-site test.

Required server-side variables:

- `KKHOME_EMAIL` — the email used to sign in to KK Home.
- `KKHOME_PASSWORD` — the KK Home password. Enter it only in the deployment's encrypted environment-variable settings, never in chat, source code, or `LOCK_DOORS_JSON`.
- `KKHOME_APP_PRIVATE_KEY` — the base64 app protocol key obtained from the installed KK Home package. Treat it as a secret and store it only as an encrypted deployment variable.
- `LOCK_DOORS_JSON` — all three doors with an exact, unique KK Home device ID.
- `LOCK_PROVIDER=kkhome` — selects the adapter.
- `KKHOME_LIVE_ENABLED=true` — final safety switch, enabled only for the acceptance test and production after the identities have been confirmed.

Until both `LOCK_PROVIDER=kkhome` and `KKHOME_LIVE_ENABLED=true` are set, no KK Home device is contacted. Missing, unknown, or duplicate device IDs fail closed.

Friends & Family stays currently have flexible checkout. To avoid locking out a guest when no departure time was promised, their codes default to expiring at 11:45 PM Eastern on the departure date. `LOCK_FLEXIBLE_CHECKOUT_HOUR` can set a different hour after the owners settle the final policy. Standard codes begin at 3:45 PM Eastern on arrival day and end 15 minutes after the confirmed checkout time.

## Provider contract

A real adapter belongs in `_lib/lock-providers/` and implements:

```js
{
  id: 'provider-name',
  installCode({ door, code, name, providerCodeId, startsAt, endsAt, timezone, idempotencyKey }),
  removeCode({ door, code, providerCodeId, startsAt, endsAt, timezone, idempotencyKey }),
}
```

Each method returns a door result with `doorId`, `status`, an optional stable `providerCodeId`, and a safe operational message. Provider calls must be idempotent because the hourly scheduler retries incomplete installations and removals.

## Cabin acceptance test

Keep `LOCK_PROVIDER=manual` until one non-critical lock passes the complete test:

1. Confirm the mechanical key and existing master access work.
2. Connect only one lock to the candidate provider.
3. Install a future-dated test code through the provider API.
4. Confirm the lock reports the code and rejects it before its start time.
5. Confirm it unlocks during the valid window.
6. Remove or expire it and confirm the keypad rejects it.
7. Repeat after a temporary Wi-Fi outage.
8. Add the other doors only after the full test passes.

After all three locks pass, retain their exact IDs in `LOCK_DOORS_JSON` and keep the live switch enabled. Never reuse `simulated` for a physical integration.

Door-code emails and guest code display release at 9:00 AM America/New_York on the calendar day before arrival. Unsent codes retry during the stay after all doors confirm installation; cancelled, removed, and past-stay codes do not send. Replacements use a new email idempotency revision. Physical lock access still begins at 3:45 PM Eastern on arrival day.

September 8 on-site verification: the owner confirmed unlock and rejection after removal on deck, front, and basement. The basement also rejected a code before its scheduled start. Automatic start/expiration boundaries were not both physically verified. Abby’s existing code subsequently unlocked all three doors during an owner-approved temporary window; that tested code was then retired and replaced for her October 23–25 stay. Her new code email is due October 22 at 9:00 AM Eastern.

Cleaner access uses one saved Cleaner Hub PIN across all three doors. Owners enter access days in Cleaner access days; off-calendar cleaning sessions also grant their dates unless canceled or explicitly removed. Suggested checkout cleanings do not grant access until the owner enters a date. Each day runs midnight through 23:59:59 America/New_York; consecutive days merge, and gaps remain inactive. Only the next continuous window is programmed to avoid duplicate PINs; the five-minute cleaner-only scheduler advances to later dates. Changes also sync immediately when saved. Existing visible cleaner PIN entries are adopted only when unique, and guest PIN collisions block synchronization. Encrypted per-door references persist between retries. A private Blob lease with conditional release prevents concurrent lock edits. No cleaner emails are sent by this integration.

Owner Lock codes (`admin.html?tab=locks`) supports named six-digit PINs, selected doors, native permanent access (`attribute:0`), and scheduled Eastern windows (`attribute:1`). Single-use codes are restricted to one door and use the app’s dedicated encrypted `/v3/device/insert-temp-pwd` command, with `/v3/device/get-temporary-key` readback. Their commands are persisted before sending and never automatically reissued after uncertainty or use. Clear an unused one-time code early in KK Home; generic slot removal is not assumed to revoke the temporary-PIN channel. Owner entries are encrypted, PINs are checked against saved guest/cleaner/owner codes, and operations serialize under a conditional Blob lease. Partial ordinary-code installations preserve per-door references for retry/revocation. No emails are sent by this area.
