# Codex MVP Log

## Final Distillation

This file is the final distillation of the MVP work done to understand how private GHL marketplace installation flows actually behave for direct location installs, agency installs, and agency-driven bulk installs.

## Objective

- Validate the real GHL behavior for private marketplace installs instead of relying on docs or guesses.
- Build a minimal reference implementation that can:
  - accept direct location installs
  - accept agency installs
  - bulk mint location tokens from a company token
  - handle partial failure and recovery
  - support future automatic installation behavior

## Final Validated App Model

The working private-app model was:

- target user: `Sub-Account`
- who can install: `Agency Only`
- bulk install: `Yes`

This was the configuration that produced a company token on agency install and allowed company-to-location minting.

For clarity: this was the validated configuration for company-token bulk install behavior. The backend still needs to keep handling direct location-token callbacks as well, because legacy/manual installs and other private install paths can still arrive that way.

The separate agency-targeted private app path was not the winning model. In practice, it was blocked by GHL scope restrictions because the agency-targeted app could not be granted `oauth.readonly` and `oauth.write`, which are required for unattended installed-location discovery and company-to-location minting.

## Final Installation Model

- Direct location install returns a location token and should persist a row in `ghl_oauth_location_tokens`.
- Agency install, when performed through the validated subaccount-target / agency-only / bulk-enabled app, returns a company token and should persist a row in `ghl_oauth_tokens`.
- Agency install must not stop at storing the company token. It must immediately discover the installed subaccounts for that app and mint location tokens for all of them.
- A later agency install must be allowed to replace older location-level tokens for the same app. Agency install becomes the authoritative parent install for that app/token key.

## Required GHL Install Choices

Two GHL install checkboxes turned out to be operationally significant:

- `approveAllLocations` / "Install under all locations"
- `installToFutureLocations` / "Install in future locations"

These are not optional niceties if the backend is expected to bulk mint location tokens without manual reapproval:

- If `approveAllLocations` is not enabled, the app is not entitled across all current subaccounts and bulk mint assumptions become invalid.
- If `installToFutureLocations` is not enabled, newly created subaccounts will not automatically receive the app and webhook-driven auto-mint will not reliably happen.

## Callback And State Conclusions

- `state` is backend-generated install context. It is useful for:
  - intended install type
  - expected location
  - safe return URL
- GHL can omit `state` on callback in real flows.
- GHL can also omit `locationId` from the token response.
- A robust backend must therefore accept missing-state callbacks and infer the flow from:
  - callback query params
  - token payload fields
  - JWT payload inference when needed

Rejecting callback traffic just because `state` is missing is too brittle for live GHL behavior.

## Live Endpoint Contract Findings

The important live endpoint findings were:

### `/oauth/installedLocations`

- requires a company bearer token
- requires the `Version` header
- requires both `companyId` and `appId`
- returns location identifiers under `_id` in live responses

### `/oauth/locationToken`

- requires a company bearer token
- requires the `Version` header
- accepts `application/x-www-form-urlencoded`
- body fields are `companyId` and `locationId`

The MVP initially failed until these exact contract details were used.

## Reliability Findings

- Company-token install and location-token minting are not always immediately consistent at callback time.
- Bounded retry materially improved install-time success.
- The backend should persist install-quality metadata so operators can see whether agency install minting completed fully or partially.
- A manual "re-mint all locations" recovery path is required when callback-time minting remains incomplete after retries.

## Future-Location Auto-Install Model

Future subaccount support needs both:

- `installToFutureLocations=true` during the agency install
- an AppInstall webhook handler in the backend

The webhook must:

- identify the correct app/profile
- resolve the stored company token
- mint a location token for the newly installed subaccount
- persist that token into `ghl_oauth_location_tokens`

## Data-Model Conclusions

### `ghl_oauth_tokens`

This table should hold company tokens keyed by `(token_key, company_id)` and should also carry:

- granted scopes
- install type / install context
- refresh bookkeeping
- install completeness fields

The install completeness fields validated by the MVP were:

- `installation_bulk_mint_complete`
- `installation_bulk_mint_attempted_at`
- `installation_bulk_mint_discovered`
- `installation_bulk_mint_minted`
- `installation_bulk_mint_failed`
- `installation_bulk_mint_retry_attempts`
- `remint_required`
- `last_remint_attempt_at`
- `last_remint_success`

### `ghl_oauth_location_tokens`

This table should hold location tokens keyed by `(token_key, location_id)` and should be linked to the company-token row that minted them when the source install was agency/company-based.

On agency install, location-token rows for that token key must be purged and replaced if they:

- have no company-token link
- point at the wrong company token
- point at a company token whose access token is null or invalid

## Precise Invalidate-On-New-Company-Install Behavior

The MVP behavior here was specific and should be preserved exactly.

### Trigger

Run invalidation immediately after:

1. the agency/company callback exchanges the code for a company token
2. the new company token row is upserted into `ghl_oauth_tokens`
3. before any bulk remint begins

The invalidation target is scoped by `token_key`. In other words, this cleanup is for "all location tokens belonging to this marketplace app installation profile", not for unrelated apps.

### Authoritative parent row

After upsert, the newly persisted company-token row becomes the authoritative parent row for that callback. The MVP then keeps only location-token rows whose parent link matches:

- `parent.id === newCompanyTokenRow.id`
- `parent.company_id === newCompanyTokenRow.company_id`

Everything else for that `token_key` is treated as stale or invalid.

### Deletion rules

For each row in `ghl_oauth_location_tokens` for the current `token_key`:

- Keep it if its `company_token_id` points to an existing company-token row and that parent row is the exact newly upserted company-token row and that parent row has the same `company_id` as the new row.
- Delete it if `company_token_id` is null or blank.
- Delete it if `company_token_id` points to no existing company-token row.
- Delete it if the parent company-token row exists but its `access_token` is null or structurally invalid.
- Delete it if the parent company-token row exists but is not the new authoritative company-token row, even if it belongs to the same app/token key.
- Delete it if the parent company-token row exists but its `company_id` does not match the new authoritative row.

### Important implication

The MVP did not merely delete "rows for a different company id." It deleted every location-token row for the app/token key that was not linked to the exact new authoritative company-token row.

That means a new agency install is treated as the owner of the app/token-key install state for that app profile.

### Categories recorded by the MVP

The MVP tracked the purge result using these buckets:

- `deletedOrphanFk`
  - row had no `company_token_id`, or the FK pointed to a missing company-token row
- `deletedInvalidParentToken`
  - parent company-token row existed, but its access token was null or structurally invalid
- `deletedWrongCompanyLink`
  - parent company-token row existed and was valid, but it was not the exact new authoritative parent row

It also recorded:

- `beforeTotal`
- `afterTotal`
- `deletedTotal`
- `beforeForApp`
- `afterForApp`
- `deletedForApp`
- `targetCompanyId`
- `targetCompanyTokenId`

### Why this aggressive invalidation exists

This behavior is what allowed the MVP to correctly handle the tested case where:

- one subaccount had already been installed directly at location level
- a later agency install was performed
- all location tokens, including the previously direct-installed one, needed to be reminted under the new company-token parent

Without this invalidation, the system would retain mixed provenance rows and the target state would no longer mean "all location tokens for this app come from the current authoritative agency install."

### What happens after invalidation

Immediately after invalidation:

- discover installed locations for the current company/app
- mint fresh location tokens for those installed locations
- persist each reminted location token with:
  - the same `token_key`
  - its `location_id`
  - the new `company_id`
  - `company_token_id = newCompanyTokenRow.id`
  - `install_type = agency_bulk`

### Failure semantics

If some remints fail after invalidation:

- the rows already deleted stay deleted
- successful remints remain stored against the new company-token row
- failed locations remain missing until retry or manual re-mint succeeds
- the company-token row must be marked with incomplete install status so the operator can recover

That exact partial-state handling was part of the validated MVP behavior.

## What The MVP Proved Against The Target Webapp

The target webapp already has several important pieces:

- stateful callback handling
- stateless callback fallback
- company token persistence
- location token persistence
- JWT-based location inference
- on-demand company-to-location mint when a location token is missing
- mismatch warning behavior when a later agency install changes company linkage

The target webapp does not yet implement the complete private bulk-install model that the MVP validated.

## Final Delta To Close

The missing pieces between the target webapp and the validated MVP are:

- installed-location discovery for a company/app pair
- agency install bulk mint for all installed locations
- live endpoint contract fixes for `installedLocations` and `locationToken`
- install-time retry and persisted mint-completeness state
- manual re-mint endpoint and UI
- AppInstall webhook ingestion for future subaccounts
- stronger operator guidance around required GHL install-time checkboxes

## Final Conclusion

The correct production model is not "one agency app plus one location app."

The validated private bulk-install model is:

- one private app targeting `Sub-Account`
- installed by `Agency`
- bulk install enabled
- backend capable of handling both company-token and location-token callback shapes
- backend capable of bulk mint, remint, and future-location webhook minting

That is the model the target webapp should be brought into conformance with.
