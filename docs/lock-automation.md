# Door-code automation

Weeks Creek Haven keeps lock access behind a provider-neutral service. The booking system decides which guest, code, and stay window apply; a provider adapter is responsible only for installing or removing that code on every configured door.

## Safety defaults

- `LOCK_PROVIDER` defaults to `manual`. This preserves the current KK Home workflow and never claims a physical lock was changed.
- `LOCK_PROVIDER=simulated` is for local and preview testing only. It is blocked automatically when `VERCEL_ENV=production`.
- A booking is marked installed only after every configured door reports success.
- A partial result leaves `doorCodeInstalledAt` empty, so the guest cannot receive or view the code.
- Owner Bookings remains the source of truth for per-door results and manual confirmations.

## Configuration

The default doors are Front door, Side door, and Back door. A future provider can attach real device IDs without changing booking code:

```json
[
  { "id": "front", "name": "Front door", "deviceId": "provider-device-id" },
  { "id": "side", "name": "Side door", "deviceId": "provider-device-id" },
  { "id": "back", "name": "Back door", "deviceId": "provider-device-id" }
]
```

Store that JSON as `LOCK_DOORS_JSON`. Device credentials and API secrets must remain server-side environment variables and must never be returned to the browser or stored in booking records.

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

After a real adapter passes, add its explicit provider name to `createLockProvider()` in `_lib/lock-service.js`. Never reuse `simulated` for a physical integration.
