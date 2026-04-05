# Target Webapp Fixes

This file is the current, concrete delta between the validated MVP and the actual implementation in `target-webapp-git`.

The goal is to make the target webapp correctly support private marketplace installs that can arrive as either:

- direct location installs
- agency installs that bulk mint location tokens for installed subaccounts

## Final Working GHL Model

The MVP validated the following real-world GHL configuration as the workable private bulk-install model:

- target user: `Sub-Account`
- who can install: `Agency Only`
- bulk install: `Yes`

This configuration returned a company token on agency install and supported company-to-location minting.

This should be read narrowly: it is the validated configuration for company-token bulk install behavior. The backend must still preserve support for direct location-token installs and callbacks, because those can still exist for legacy/manual installs and other private-app flows.

The separate agency-targeted private app model should not be treated as the primary path for the target webapp. In practice, it did not permit the required OAuth-management scopes for unattended bulk install flows.

## What The Target Webapp Already Has

The target implementation already contains important groundwork and should not be regressed:

### Already implemented

- stateful OAuth install flow in [target-webapp-git/src/server/ghl/oauth/installation-routes.ts](target-webapp-git/src/server/ghl/oauth/installation-routes.ts)
- stateless callback fallback when GHL omits `state`
- location-id inference from callback query, state, and JWT payload in [target-webapp-git/src/server/services/ghl/oauth/token-utils.ts](target-webapp-git/src/server/services/ghl/oauth/token-utils.ts)
- company token persistence in `ghl_oauth_tokens`
- location token persistence in `ghl_oauth_location_tokens`
- runtime on-demand company-to-location mint when a location token is missing
- mismatch warning and dedupe behavior for agency install replacement
- frontend agency-install entry page and warning banner

### Therefore not required

- basic company-token storage
- basic location-token storage
- missing-state callback tolerance
- company-id mismatch warning plumbing

Those already exist. The remaining work is bulk-install-specific.

## Concrete Gaps

## 1. Bulk installed-location discovery is missing

Current target behavior:

- [target-webapp-git/src/server/services/ghl/oauth/install/agency-install-manager.ts](target-webapp-git/src/server/services/ghl/oauth/install/agency-install-manager.ts) saves the company token and only mints `expectedLocationId` if one was present in state.

What is required:

- add a real installed-locations discovery step after agency install
- call GHL `GET /oauth/installedLocations`
- send:
  - company bearer token
  - `Version: ${GHL_API_VERSION}`
  - query params `companyId` and `appId`
- parse location ids from `_id` as well as `locationId` and `id`

Why:

- a private bulk-installed app is not "done" after storing the company token
- the backend must discover all locations where that app is installed and mint tokens for all of them

## 2. The target config is missing app identity required for bulk discovery

Current target behavior:

- [target-webapp-git/src/server/config.ts](target-webapp-git/src/server/config.ts) has `GHL_OAUTH_CLIENT_ID`, `GHL_OAUTH_CLIENT_SECRET`, `GHL_OAUTH_SCOPES`, and `GHL_OAUTH_AGENCY_INSTALL_URL`
- it does not expose an explicit `appId` or `versionId`

What is required:

- add config for `GHL_OAUTH_APP_ID`
- optionally also add `GHL_OAUTH_VERSION_ID`
- alternatively parse these from the real private install URL if you choose to store the install URL itself as config

Why:

- live `installedLocations` requests require `appId`
- the target app cannot implement real bulk discovery without it

## 3. The company-to-location mint request shape is wrong for live GHL behavior

Current target behavior:

- [target-webapp-git/src/server/services/ghl/oauth.ts](target-webapp-git/src/server/services/ghl/oauth.ts) sends `POST /oauth/locationToken`
- body is JSON
- no `Version` header is sent

What is required:

- change `exchangeCompanyTokenForLocationToken(...)` to send:
  - `Version: ${GHL_API_VERSION}`
  - `Content-Type: application/x-www-form-urlencoded`
  - form body with `companyId` and `locationId`

Why:

- the MVP only worked after matching the live endpoint contract
- the current target implementation is not aligned to the live contract that was actually validated

## 4. Agency install currently behaves like a single-location reconnect, not a bulk install

Current target behavior:

- [target-webapp-git/src/server/services/ghl/oauth/install/agency-install-manager.ts](target-webapp-git/src/server/services/ghl/oauth/install/agency-install-manager.ts) only:
  - stores company token
  - optionally mints one location token if `expectedLocationId` exists

What is required:

- replace that agency callback orchestration with:
  1. store company token
  2. discover installed locations for the app/company
  3. purge stale or invalid location-token rows for that token key
  4. mint location tokens for all installed locations
  5. record install-quality counters
  6. redirect with status information available to the frontend

Why:

- bulk install is the main behavior to support
- the current implementation only covers the small subset case where one location is explicitly targeted

## 5. Agency install must replace older location installs for the same app

Current target behavior:

- target already has `upsertAndDeleteMismatchedCompanyRowsForAgencyInstall(...)` and mismatch warnings in [target-webapp-git/src/server/services/ghl/oauth.ts](target-webapp-git/src/server/services/ghl/oauth.ts)
- however, it only acts when minting a specific location row

What is required:

- on agency install, purge all location-token rows for the app/token key that:
  - have no company-token FK
  - point to a different company-token row
  - point to a company-token row whose access token is null or structurally invalid
- then remint fresh location tokens linked to the newly stored company token row

Why:

- the validated MVP proved that previously direct-installed location tokens must be replaced when a later agency install becomes authoritative

### Required exact invalidation spec

The target implementation should mirror the MVP’s semantics, which were stricter than a simple "delete rows for a different company id" rule.

The required sequence is:

1. upsert the new company token row in `ghl_oauth_tokens`
2. treat that exact persisted row as the authoritative parent row for this callback
3. scan all `ghl_oauth_location_tokens` rows for the same `token_key`
4. delete every row that is not linked to that exact new parent row
5. bulk remint all installed locations for the company/app

### Exact delete predicate

For each `ghl_oauth_location_tokens` row with the same `token_key`:

- keep the row only if:
  - `company_token_id` is present
  - it resolves to an existing row in `ghl_oauth_tokens`
  - the parent row has a structurally valid `access_token`
  - `parent.id === newCompanyTokenRow.id`
  - `parent.company_id === newCompanyTokenRow.company_id`

Delete the row if any of the following are true:

- `company_token_id` is null or blank
- `company_token_id` points to no company-token row
- parent company-token row exists but its `access_token` is null or structurally invalid
- parent company-token row exists but is not the new authoritative parent row
- parent company-token row exists but its `company_id` does not match the new authoritative row

### Important consequence

This means a later agency install invalidates not only:

- orphaned rows
- wrong-company rows

but also:

- previously direct-installed location-token rows for this app/token key
- rows tied to an older company-token row for the same app/token key

That behavior is intentional. The new agency install becomes the source of truth for all location-token rows for that app profile.

### Required observability

The target implementation should also persist or log purge result buckets equivalent to the MVP:

- `deletedOrphanFk`
- `deletedInvalidParentToken`
- `deletedWrongCompanyLink`
- `beforeForApp`
- `afterForApp`
- `deletedForApp`
- `targetCompanyId`
- `targetCompanyTokenId`

### Required post-purge behavior

After purge:

- immediately bulk mint installed locations
- persist reminted rows with `company_token_id = newCompanyTokenRow.id`
- mark company-token install status incomplete if any location remint fails
- expose operator recovery via manual re-mint

## 6. Install-time retry and install-quality state are missing

Current target behavior:

- there is no persisted bulk-install completion state
- there is no bounded retry loop for partial mint failure
- repo search shows no implementation for:
  - `installation_bulk_mint_*`
  - `remint_required`
  - `remint-all`

What is required:

- add columns to `ghl_oauth_tokens` for:
  - `installation_bulk_mint_complete`
  - `installation_bulk_mint_attempted_at`
  - `installation_bulk_mint_discovered`
  - `installation_bulk_mint_minted`
  - `installation_bulk_mint_failed`
  - `installation_bulk_mint_retry_attempts`
  - `remint_required`
  - `last_remint_attempt_at`
  - `last_remint_success`
- implement bounded retry during agency callback

Why:

- live company-to-location minting can partially fail during callback and succeed a few seconds later
- target needs first-class install quality tracking, not just best-effort background behavior

## 7. Manual recovery route and UI are missing

Current target behavior:

- there is no backend route for "re-mint all locations"
- there is no admin/operator UI for incomplete bulk installs

What is required:

- add a backend route that:
  - reloads the stored company token
  - re-discovers installed locations
  - retries minting for all of them
  - updates install-quality fields
- add an operator-visible frontend control for agency owners/admins when install-time minting was incomplete

Why:

- this was necessary in the MVP because callback-time minting was not always complete on the first pass

## 8. AppInstall webhook support for future subaccounts is missing

Current target behavior:

- repo search shows no route for:
  - `webhooks/ghl/app-install`
  - `simulate-app-install`
- there is no handler for marketplace AppInstall events

What is required:

- add a webhook route for AppInstall events for this marketplace app
- use the stored company token to mint a location token for the newly installed subaccount
- persist the location token
- reject or skip events for unrelated app ids / version ids

Why:

- future subaccount onboarding depends on both:
  - `installToFutureLocations=true` at agency install time
  - a backend listener that mints the new location token when GHL notifies the install

## 9. Frontend guidance is too weak for the validated bulk-install model

Current target behavior:

- [target-webapp-git/frontend/src/app/auth/AgencyInstallPage.tsx](target-webapp-git/frontend/src/app/auth/AgencyInstallPage.tsx) has agency-install copy and a mismatch warning
- it does not explicitly instruct operators to check the two critical GHL install checkboxes

What is required:

- update agency-install/operator-facing UX to strongly instruct the installer to enable:
  - "Install under all locations" / `approveAllLocations`
  - "Install to future locations" / `installToFutureLocations`

Why:

- without those choices, the backend cannot safely assume current and future location entitlement for bulk mint

## 10. Configuration and runbook docs still describe a location-first operational model

Current target behavior:

- docs such as [target-webapp-git/docs/configuration.md](target-webapp-git/docs/configuration.md) and [target-webapp-git/docs/agency-oauth-cutover-runbook.md](target-webapp-git/docs/agency-oauth-cutover-runbook.md) describe agency token storage and runtime mint fallback
- they do not describe the validated private bulk-install flow in full

What is required:

- document that the winning private bulk-install app configuration is:
  - subaccount target
  - agency-only installer
  - bulk enabled
- document the required install checkboxes
- document installed-locations discovery, install-time retry, re-mint recovery, and AppInstall webhook minting

Why:

- the operational model is now different from a simple per-location reconnect model

## 11. Scope/config source-of-truth needs tightening

Current target behavior:

- config is built around `GHL_OAUTH_SCOPES`
- docs emphasize reconnecting each location when scope changes

What is required:

- treat the actual private app install configuration as source-of-truth for granted scopes
- keep runtime scope checks aligned with the live marketplace app
- do not assume an agency-targeted private app can receive `oauth.readonly` and `oauth.write`

Why:

- the MVP showed that platform-level scope allowances are part of the architecture, not just a docs concern

## 12. Preserve existing missing-state support

Current target behavior:

- [target-webapp-git/src/server/ghl/oauth/installation-routes.ts](target-webapp-git/src/server/ghl/oauth/installation-routes.ts) already handles callbacks without `state`

What is required:

- keep that behavior
- expand tests around it if needed
- do not regress to "state is mandatory" assumptions

Why:

- live GHL callbacks can arrive without `state`
- this was observed in practice and the target app is already on the right side of that issue

## Summary Of The Real Delta

The target webapp already supports:

- direct location installs
- company-token persistence
- stateless callback tolerance
- runtime company-to-location mint fallback

The target webapp does not yet support:

- agency install as a true bulk-installed location-token seeding event
- installed-locations discovery for a company/app
- callback-time retry with persisted completeness state
- operator-triggered remint
- future-location auto-mint via AppInstall webhook
- the exact live endpoint contract validated by the MVP

That is the concrete implementation gap that still needs to be closed.
