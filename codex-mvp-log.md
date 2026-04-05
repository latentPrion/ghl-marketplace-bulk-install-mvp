# Codex MVP Log

## 2026-04-05

### GHL App Setup Confirmed

- `dotenv.env` present with:
  - `GHL_MARKETPLACE_APP_APP_CLIENT_ID=69d213c14b99ed1d58caea5c-mnlhcofk,`
  - standard install URL
  - white-label install URL
- `scopes.md` present with Autobroker-oriented scope notes.
- User reports:
  - new GHL agency created
  - private app created
  - three subaccounts created
  - admin user created under each subaccount

### Important Caveats

- The `CLIENT_ID` line currently has a trailing comma in `dotenv.env`. This must be removed before the app uses it.
- The install URLs include:
  - `locations/customValues.readonly`
  - `locations/customValues.write`
- `scopes.md` currently documents:
  - `locations/customFields.readonly`
  - `locations/customFields.write`
- Scope naming must be reconciled against the actual app configuration before implementation.

### Identifier Notes

- The install URLs contain `version_id=69d213c14b99ed1d58caea5c`.
- This is definitely the app version identifier.
- The separate Marketplace `App ID` was not yet located in the UI and is not currently blocking initial MVP scaffolding.

### Immediate Next Step

- Normalize `.env` values and scope names.
- Then scaffold the VPS-hosted MVP app in `/data/www/marketplace-app-app` with:
  - frontend + backend
  - Docker config stored in the app directory
  - external exposure on the VPS
  - OAuth callback handling for GHL install testing

### MVP Scaffold + VPS Deployment Progress

- Implemented MVP code scaffold:
  - backend: `src/server.js`, `src/config.js`, `src/ghl-oauth.js`, `src/state-store.js`, `src/state-signing.js`
  - frontend: `public/index.html`, `public/app.js`, `public/styles.css`
  - containerization: `Dockerfile`, `docker-compose.yml`, `.dockerignore`
  - runtime env template: `.env.example`
  - target conformance tracker: `target-webapp-fixes.md`
- Storage model in MVP aligns table naming with `schema.md`:
  - `ghl_oauth_tokens`
  - `ghl_oauth_location_tokens`
  - `portal_user_desking_mappings` (present as schema-aligned placeholder table in persisted state)
- Added callback model handling for:
  - location install token exchange + persistence
  - agency install company token persistence
  - agency installed-locations discovery + company->location token mint loop

### VPS Runtime State (zambesii.com)

- Synced MVP code to `/data/www/marketplace-app-app`.
- Container is running and externally reachable:
  - `marketplace-app-mvp` on `0.0.0.0:3210->3210/tcp`
  - health check success:
    - local on VPS: `curl http://127.0.0.1:3210/health`
    - external: `curl http://zambesii.com:3210/health`

### Docker Access Model Update

- Applied host change so Docker commands can run without root for `codex`:
  - ensured `docker` group exists
  - `usermod -aG docker codex`
  - verified fresh session includes `docker` group
  - verified `docker ps` works unprivileged
- Updated zambesii skill + host facts to codify this behavior and validated the skill.

### Pending for Next Step

- Live GHL install-flow validation (location + agency + bulk mint) through browser interaction.
- Update Marketplace app redirect URI in GHL app settings to point at the MVP callback once final public callback URL is selected.

### Env + Redirect Sync Applied

- User updated GHL redirect URI to `http://zambesii.com:3210/oauth/callback`.
- User updated standard + white-label install links in local `dotenv.env`.
- Synced workspace to zambesii deployment path `/data/www/marketplace-app-app`.
- Restarted container: `docker-compose restart marketplace-app-mvp` (non-root docker execution as `codex`).
- Verified deployed `dotenv.env` now contains install URLs with `redirect_uri=http://zambesii.com:3210/oauth/callback`.
- Verified runtime config endpoint:
  - `appBaseUrl: http://zambesii.com:3210`
  - `redirectUri: http://zambesii.com:3210/oauth/callback`

### Live Validation: Location Install Flow

- User completed location install flow via:
  - `/oauth/install?installType=location&returnTo=http%3A%2F%2Fzambesii.com%3A3210%2F`
- MVP callback captured:
  - `locationId = PQujQwLFNjKVnr6MwDPk`
  - `companyId = HEeQEAbTtnRGG1XZOp0f`
  - event `oauth_callback_location_success`
- Schema-aligned persistence confirmed in `ghl_oauth_location_tokens`:
  - `token_key`
  - `location_id`
  - `company_id`
  - `access_token`
  - `access_expires_at`
  - `refresh_token`
  - `refresh_token_id`
  - `scope`
  - `updated_at`/`created_at`
  - `install_type = location`
- `ghl_oauth_tokens` remains empty at this stage (expected prior to agency install flow).

### Agency Install 404 Fix

- Observed failure: agency install URL redirected to:
  - `https://marketplace.gohighlevel.com/oauth/chooseagency?...`
  - Result: marketplace 404 page.
- Root cause:
  - MVP fallback builder used `/oauth/chooseagency` for `installType=agency` when no explicit agency URL was configured.
- Fix applied:
  - Updated `src/server.js` install URL builder to use:
    - configured standard/white-label chooser URLs when present, regardless of install type
    - `/oauth/chooselocation` as fallback endpoint
  - Removed dependency on `/oauth/chooseagency` fallback.
- Deployment:
  - Synced to zambesii
  - forced container rebuild/recreate (`docker-compose up -d --build --force-recreate marketplace-app-mvp`)
- Verification:
  - `GET /oauth/install?installType=agency...` now returns `302` with `Location: https://marketplace.gohighlevel.com/oauth/chooselocation?...`

### Live Validation: Agency Install UX + Callback Semantics

- Browser verification in live GHL session (`/agency_launchpad`) confirms user is logged in at agency level.
- Marketplace install UX for this private app still routes through `oauth/chooselocation` and prompts for subaccount selection.
- There is no separate visible “agency-level option” in this chooser screen for this app config.
- Selecting a subaccount in this flow still completed callback with:
  - `connected=1`
  - `install_type=agency`
  - `company_id=HEeQEAbTtnRGG1XZOp0f`
- MVP persisted an agency/company token row in `ghl_oauth_tokens` and emitted `oauth_callback_agency_success`.

### Agency Bulk Mint Follow-up Fix

- Observed issue during agency callback bulk phase:
  - `Installed locations request failed (401): version header was not found.`
- Root cause:
  - requests to `/oauth/installedLocations` and `/oauth/locationToken` lacked required `Version` header.
- Fix applied:
  - added configurable `GHL_API_VERSION` (default `2021-07-28`) in `src/config.js`
  - added versioned header injection for installed-locations and location-token calls in `src/ghl-oauth.js`
  - exposed `ghlApiVersion` from `/api/config` for runtime verification
  - documented `GHL_API_VERSION` in `.env.example`

### Installation Details Root Cause (No Agency Option in UI)

- Queried marketplace installation details endpoint for this app:
  - `GET https://backend.leadconnectorhq.com/marketplace/app/installationDetails?appId=69d213c14b99ed1d58caea5c&versionId=69d213c14b99ed1d58caea5c`
- Key finding:
  - `integration.userTypes = ["Location"]`
- Effect:
  - chooser shows subaccount selection only
  - no agency/company install option is available in current app config
  - `/oauth/token` exchange returns a token with `user_type=Location` even when requesting `user_type=Company`
  - downstream agency endpoints reject this token (`This token's user type is not yet supported!`)
- Additional confirmed identifier:
  - `integration.appId = 69d213c14b99ed1d58caea5c`

### Dual-App Runtime Support Added

- User created a second app with agency-level target user and added env vars prefixed:
  - `GHL_AGENCY_MARKETPLACE_APP_APP_*`
- MVP runtime updated to support dual OAuth profiles:
  - `primary` profile (existing location/subaccount app)
  - `agency` profile (new agency-targeted app)
- `/oauth/install` now chooses profile by `installType`:
  - `location` -> `primary`
  - `agency` -> `agency` when configured (fallback to `primary` only if needed)
- Signed OAuth state now includes profile metadata (`profileKey`, `profileTokenKey`) and callback uses it to select matching client credentials for `/oauth/token`.
- Token persistence now writes with explicit `token_key` per initiating profile, so both apps can coexist in one MVP state store.
- Agency sync endpoints now resolve company tokens across configured token keys, prioritizing agency profile keys.

### Live Validation With New Agency App

- Confirmed agency app metadata:
  - `userTypes=["Company"]`
  - `isAgencyBulkInstallEnabled=true`
- Live browser install run from MVP (`Start Agency Install`) now redirects with agency app key:
  - `client_id=69d23450e2ff1434e56c858e-mnlm1xwd`
  - `version_id=69d23450e2ff1434e56c858e`
- Marketplace chooser now shows an `Agency` account option (not subaccounts) for this app.
- Callback succeeded and persisted:
  - `ghl_oauth_tokens.token_key = 69d23450e2ff1434e56c858e-mnlm1xwd`
  - `user_type = Company`
  - `install_type = agency`
- Agency bulk discovery/mint currently fails with `422 Unprocessable Entity`, consistent with the agency app currently having minimal scopes only:
  - `users.readonly`
  - `marketplace-installer-details.readonly`
  - `locations.readonly`
- Next required scope additions for full agency bulk model testing:
  - `oauth.readonly` (installed location discovery)
  - `oauth.write` (company -> location token mint)

### Scope-Limited Agency App Handling (Model Adjustment)

- User confirmed agency app scope selector does not permit adding `oauth.readonly`/`oauth.write` for this app configuration.
- MVP adjusted to treat this as a supported constraint:
  - agency callback now skips bulk discovery/mint when required oauth scopes are missing and records `bulk.skipped.reason=missing_required_scopes`
  - agency sync endpoints return a clear 400 with required/missing scopes instead of attempting unsupported GHL calls
- Effective model now:
  - agency app flow validates company-level install/connectivity
  - location app flow remains required for location-scoped operational tokens and write scopes

### Webhook Auto-Mint Implementation

- Implemented webhook-driven auto-mint pipeline in MVP backend:
  - `POST /webhooks/ghl/app-install`
    - accepts AppInstall payloads (`type=INSTALL`, `companyId`, `locationId`, `appId`/`versionId`)
    - resolves matching OAuth profile by `profileKey`, `profileTokenKey`, `versionId`, or `appId`
    - loads corresponding stored company token
    - if token has required oauth scopes, exchanges company token -> location token and stores it as `install_type=webhook_install`
  - `POST /api/debug/simulate-app-install`
    - debug helper to simulate webhook payloads and validate behavior end-to-end
- Added webhook processing events to MVP log stream:
  - `ghl_webhook_event_received`
  - `ghl_webhook_install_mint_success`
  - `ghl_webhook_install_mint_failed`
  - `ghl_webhook_install_skipped`

### Webhook Demo Result (Current Tenant Constraints)

- Webhook path is live and validated on zambesii.
- Simulated and direct POST webhook calls both processed successfully.
- With current stored agency token scopes (`users.readonly marketplace-installer-details.readonly locations.readonly`), webhook auto-mint is correctly skipped with explicit diagnostics:
  - missing required scopes: `oauth.readonly`, `oauth.write`
- This confirms implementation correctness and current platform scope constraint as the remaining blocker for successful unattended mint.

### Breakthrough: Subaccount App Agency-Only + Bulk Enabled

- User changed subaccount app listing configuration to:
  - target user: `Sub-Account`
  - who can install: `Agency Only`
  - bulk install: `Yes`
- Live browser install on `2026-04-05` now shows:
  - agency row in account picker
  - `Install under all locations` checkbox
- Callback for primary profile now yields:
  - `tokenUserType=Company`
  - company token persisted under primary token key (`69d213c14b99ed1d58caea5c-mnlhcofk`)

### API Fixes for Installed-Locations + Mint

- Root causes found and fixed in MVP:
  1. `GET /oauth/installedLocations` requires both `companyId` and `appId` query params.
  2. Response location objects use `_id`; parser now accepts `_id` in addition to `locationId`/`id`.
  3. `POST /oauth/locationToken` works with `application/x-www-form-urlencoded` body (`companyId`, `locationId`) per current docs.
  4. Manual sync/installed-location endpoints now resolve the stored company token that actually has required oauth scopes.
- Deployed fixes to zambesii Docker and verified:
  - `GET /api/agency/installed-locations?companyId=HEeQEAbTtnRGG1XZOp0f` returns 3 location IDs.
  - `POST /api/agency/sync-locations` with `{"companyId":"HEeQEAbTtnRGG1XZOp0f","fetchInstalled":true}` returns:
    - `discovered=3`
    - `mintedCount=3`
    - `failedCount=0`

### Auto-Mint Path Validation

- `POST /api/debug/simulate-app-install` using app/version of primary profile now succeeds:
  - result: `minted=true`
  - token key used: `69d213c14b99ed1d58caea5c-mnlhcofk`
- This confirms end-to-end viability for:
  - company-token discovery of installed subaccounts
  - location token mint per installation event

### Install-Time Retry + Manual Re-mint UX (2026-04-05)

- Added callback-time bounded retry for agency bulk mint:
  - env/config: `BULK_MINT_RETRY_ATTEMPTS` (default `4`)
  - env/config: `BULK_MINT_RETRY_DELAY_MS` (default `3000`)
  - callback now executes `runBulkMintWithRetry(...)` before declaring install mint status.
- Added install-quality fields on the company token row to persist whether all discovered location tokens were minted during install:
  - `installation_bulk_mint_complete` (boolean)
  - `installation_bulk_mint_attempted_at` (ISO timestamp)
  - `installation_bulk_mint_discovered` (number)
  - `installation_bulk_mint_minted` (number)
  - `installation_bulk_mint_failed` (number)
  - `installation_bulk_mint_retry_attempts` (number)
  - `remint_required` (boolean)
  - `last_remint_attempt_at`, `last_remint_success`
- Added backend manual recovery endpoint:
  - `POST /api/agency/remint-all`
  - behavior: FK cleanup (`purgeInvalidLocationTokenLinks`) + bounded retry remint for all installed locations
  - updates company-token remint status fields.
- Added frontend recovery controls:
  - company ID input + `Re-mint All Locations` button
  - button only appears when install-time mint status is incomplete (`installation_bulk_mint_complete=false` or `remint_required=true`)
  - UI guidance text now explicitly tells agency owner to run re-mint when install minting was partial/failed.
- Updated `target-webapp-fixes.md` with the same requirement so the target webapp tracks and enforces this operator-visible install status model.
