# Consent records (Terms of Service, Privacy Policy, WhatsApp)

Proof of **when** each user accepted the Terms of Service and Privacy Policy (and their WhatsApp
opt-in / opt-out). Stored in `user_consents` — an **append-only** audit log: the database refuses
`UPDATE` and `DELETE` (triggers); a change (e.g. WhatsApp opt-out) is always a **new row**.

| Piece | Where |
|---|---|
| Policy versions | App config → Legal: `legal.termsVersion`, `legal.privacyVersion` — the app sends them with the consent so each record shows which version was accepted |
| Table + triggers | `server/prisma/migrations/20261114140000_user_consents/migration.sql` |
| Rules (pure) | `server/src/lib/consents.ts` |
| Saving / admin history | `server/src/controllers/consents.controller.ts` (used by `/userProfile`) |
| Tests | `server/test/consents.test.ts` (unit), `server/test/integration/consents.api.test.ts` (MySQL) |

## How consents arrive

There is no separate consent API for the app. The login screen's checkboxes are sent with the user
profile call after OTP — `POST /api/v1/userProfile` (see docs/ANDROID_APP_CONFIG.md §5.3):
```json
{
  "isProfileCompleted": true, "role": "TENANT", "fullName": "…", "gender": "MALE", "dateOfBirth": "1995-04-10",
  "city": "Hyderabad", "state": "Telangana",
  "consents": [
    { "type": "TERMS",    "version": "2026-11-01", "granted": true },
    { "type": "PRIVACY",  "version": "2026-11-01", "granted": true },
    { "type": "WHATSAPP", "version": "",           "granted": false }
  ],
  "clientAcceptedAt": 1763106000000, "source": "ANDROID", "appVersion": "1.0"
}
```
- `accepted_at` = **server** time; `client_accepted_at` = the phone's time; IP and User-Agent from the request.
- TERMS / PRIVACY: `granted` must be `true`; `version` = the policy version shown (`legal.termsVersion` / `legal.privacyVersion`).
- WHATSAPP: `version` must be `""`; `granted` true = opt-in, false = opt-out (each change is a new row).
- Idempotent: a consent equal to the latest row of its type is not inserted again.
- A **new account** can't be created without TERMS + PRIVACY accepted (now or earlier).
- The response, `GET /auth/me` and `POST /auth/phone/complete` carry `termsAccepted` (Terms AND Privacy accepted);
  `/userProfile` also returns `consents`:
```json
"consents": {
  "terms":    { "accepted": true, "acceptedVersion": "2026-11-01", "acceptedAt": "2026-11-14T07:54:00.000Z" },
  "privacy":  { "accepted": true, "acceptedVersion": "2026-11-01", "acceptedAt": "2026-11-14T07:54:00.000Z" },
  "whatsapp": { "granted": false, "updatedAt": "2026-11-14T07:54:00.000Z" }
}
```

### GET /api/v1/admin/users/:uid/consents  (read-only, permission `consents.view` — Super Admin by default)
```bash
curl "$API/api/v1/admin/users/kVJVbyY9utU44h0QrwfGBdKclbz1/consents" -H "Authorization: Bearer $SUPER_ADMIN_TOKEN"
```
```json
{
  "success": true, "message": "OK",
  "data": {
    "uid": "kVJVbyY9utU44h0QrwfGBdKclbz1",
    "user": { "id": "…", "fullName": "…", "phoneNumber": "+91…", "role": "TENANT" },
    "status": { "terms": { … }, "privacy": { … }, "whatsapp": { … } },
    "history": [
      { "id": "42", "type": "WHATSAPP", "version": "", "granted": false, "acceptedAt": "2026-11-14T08:10:00.000Z",
        "clientAcceptedAt": "2026-11-14T08:09:58.000Z", "role": "TENANT", "source": "ANDROID", "appVersion": "1.0",
        "ipAddress": "203.0.113.7", "userAgent": "okhttp/4.12.0", "createdAt": "2026-11-14T08:10:00.000Z" }
    ]
  },
  "meta": null
}
```
`user` is `null` when the uid consented but never finished registration. History is newest first (max 1000).

## Errors (standard error envelope)

| Status | errorCode | When |
|---|---|---|
| 401 | `UNAUTHENTICATED` / `SESSION_REQUIRED` | Missing token / invalid or expired token |
| 400 | `VALIDATION_ERROR` | New account without TERMS + PRIVACY accepted, bad type / role / source, Terms or Privacy with `granted: false` or no version, duplicate type, unknown field, implausible `clientAcceptedAt` |
| 429 | `RATE_LIMITED` | More than 30 consent saves / hour |
| 500 | `INTERNAL_ERROR` | Unexpected error (logged on the server; no stack trace in the response) |


## Operations notes
- The migration creates two MySQL **triggers**. On managed MySQL with binary logging (e.g. RDS) creating triggers
  needs `log_bin_trust_function_creators = 1` (or a user with the TRIGGER/SUPER privilege) — set it before deploying.
- Resetting a **test** database: use `TRUNCATE TABLE user_consents` (triggers block `DELETE`).
