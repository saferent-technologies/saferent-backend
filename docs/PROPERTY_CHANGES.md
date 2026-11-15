# Change requests for approved / live properties

Editing an **APPROVED** or **PUBLISHED** property never changes the live listing. Edits are saved as a
change request and go live only after SafeRent approves them. Tenants and every browse / public API
always read the live data.

DRAFT and REJECTED properties (never approved) keep the normal flow: edit → `POST /properties/{id}/submit`.

## How it works
- The first edit (any wizard endpoint: `PATCH /properties/{id}`, units / bulk / floors / unit pricing,
  rooms / beds, pricing + charges, utilities, policies, amenities, photo upload / update / delete) starts a
  **DRAFT** change. All later edits go to it. Same request bodies, same validation.
- Moving between wizard steps only (`PATCH { wizardStep }`) saves nothing and starts no change.
- **Ids:** inside a change, units / rooms / beds / photos have their own ids (`sourceId` = the live row).
  Always load the wizard with `GET /properties/{id}?view=draft` and use the ids from that response.
- New photos stay hidden from tenants until the change is approved (they're approved with it).
- Documents are not part of a change: they're uploaded and verified on the property directly.
- While the change is **PENDING_VERIFICATION**, every edit → `412 INVALID_STATE` "Your changes are being verified…".
- A unit / bed with an active lease can't be removed (412, as on the live listing; 409 if it slipped through at approval).
- Active leases keep their own rent; a change never edits a lease.

## Reads
`GET /properties/{id}`
```json
{ "property": { …live… },
  "can": { "manage": true, …, "editRevision": true, "submitRevision": true, "discardRevision": true },
  "pendingRevision": { "id": "…", "status": "DRAFT", "changedSections": [], "createdAt": "…",
                       "submittedAt": null, "decidedAt": null, "moderationNote": null },
  "lastRevision": null }
```
`pendingRevision.status`: DRAFT | PENDING_VERIFICATION | REJECTED (with `moderationNote`). `null` = no open change.
`lastRevision`: the latest finished change (APPROVED / DISCARDED) when there's no open one.

`GET /properties/{id}?view=draft` → the property **as changed so far** (same shape, live `id` / `code` /
statuses, `"isDraftView": true`). Without an open change it returns the live property.
`GET /properties/{id}/completeness?view=draft` → completeness and `submissionProblems` of the change.

`GET /properties` → each item has `hasDraftChanges` (open change) and `changesStatus`
(DRAFT | PENDING_VERIFICATION | REJECTED | APPROVED | DISCARDED | null).
`GET /properties/summary` → `changes: { underVerification, draftOrRejected }`.

## Actions
- `POST /properties/{id}/revision/submit` (or `POST /properties/{id}/submit`) →
  200 "Changes sent for verification. Your listing stays live meanwhile."
  `{ "pendingRevision": { "status": "PENDING_VERIFICATION", "changedSections": ["basic","pricing"], … } }`
  412 + `details.problems[]` when something required is missing; 412 "You haven't changed anything yet."
- `DELETE /properties/{id}/revision` → 200 "Changes discarded" (live untouched). 412 while under verification.
- Rejected → the owner edits again (the change goes back to DRAFT) and resubmits.

`changedSections`: basic, location, building, units, rooms, pricing, utilities, policies, amenities, photos.

## Admin (listings.approve)
- `GET /admin/property-revisions?status=PENDING_VERIFICATION` → queue.
- `GET /admin/property-revisions/{revisionId}` → `{ revision, live, changed, changedSections, owner }`.
- `POST /admin/property-revisions/{revisionId}/review` `{ "decision": "APPROVE" }` or
  `{ "decision": "REJECT", "reason": "…" }` (reason ≥ 5 chars).
  Approve applies the change to the live listing in one transaction (live ids kept, version bumped,
  PUBLISHED / APPROVED status kept). The owner gets a push + in-app notification (link `/properties/{id}`).
- Status history records `changeRequest`: PENDING_VERIFICATION / REJECTED / APPROVED / DISCARDED.
