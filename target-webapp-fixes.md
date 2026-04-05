# Target Webapp Fixes

This file tracks concrete edits required in `target-webapp-git` (read-only here) so the target implementation matches the validated MVP model.

## Current Candidate Fixes

## Critical Install Requirement (Do Not Skip)

Agency install must be performed with:

1. `Install under all locations in <agency>` enabled (`approveAllLocations=true`)
2. `Enable automatic installation to future locations` enabled (`installToFutureLocations=true`) whenever future subaccounts should auto-receive the app

This is a hard operational requirement for the target webapp’s no-manual-consent subaccount token model.

If `approveAllLocations` is not enabled at install time:

- installation scope is not guaranteed to include all current subaccounts
- downstream bulk mint expectations can fail because platform-side install entitlement is incomplete
- behavior becomes inconsistent across locations and cannot be assumed from company token alone

If `installToFutureLocations` is not enabled:

- newly created subaccounts will not auto-install this app
- webhook-driven automatic mint for future subaccounts will not reliably trigger
- operators will need manual reinstall/scope correction work later

Treat these two checkboxes as required install controls, not optional UX toggles.

1. Normalize `GHL_OAUTH_CLIENT_ID` input by trimming trailing commas before using it as token key.
2. Treat configured install URLs as source-of-truth for active scopes and keep docs/runtime checks aligned to those exact scope strings.
3. Validate that agency callback path performs explicit bulk discovery (`installedLocations`) + mint (`locationToken`) during install when bulk install is expected, not only lazy runtime mint.
4. Ensure callback state handling preserves targeted location intent and still succeeds when `locationId` is omitted by token response.
5. Keep company token persistence (`ghl_oauth_tokens`) and location token persistence (`ghl_oauth_location_tokens`) in schema-aligned columns compatible with the live DB contract in `schema.md`.
6. Do not assume a distinct agency chooser route. In current marketplace behavior, agency installs still go through `oauth/chooselocation` with subaccount selection; treat `state.installType=agency` + callback `company_id` as agency flow trigger.
7. Send required `Version` header (e.g. `2021-07-28`) on `/oauth/installedLocations` and `/oauth/locationToken`; without it, GHL returns `401` with “version header was not found.”
8. Keep agency callback tolerant when token response returns `user_type=Location`; derive agency semantics from requested install type and presence of `company_id`, then persist agency/company token state accordingly.
9. Add hard validation/telemetry for app installation metadata `integration.userTypes`; if it is `["Location"]` only, agency bulk endpoints will fail (`This token's user type is not yet supported!`) and agency install UX will remain subaccount-only.
10. Support distinct OAuth app credentials by install mode (`location` vs `agency`) so an immutable location-targeted app and a separate agency-targeted app can be tested side-by-side without token-key collisions.
11. For agency bulk install implementation, ensure agency app scope set includes OAuth management scopes (`oauth.readonly` + `oauth.write`) in addition to minimal identity scopes; otherwise installed-location discovery and location-token mint endpoints return non-success (observed `422`).
12. When agency profile lacks required oauth scopes, treat bulk discovery/mint as unsupported and short-circuit with explicit diagnostics instead of hard-failing callback/install completion.
13. Add AppInstall webhook ingestion for subaccount target apps and mint location token on each install event (`companyId` + `locationId`) using stored company token from the matching app profile.
14. Resolve webhook-to-profile mapping defensively (profile key/token key + versionId + appId) because multiple marketplace app profiles may coexist in one backend.
15. Add a safe debug simulation endpoint for AppInstall payloads in non-production environments to validate token-mint pipeline without waiting for marketplace events.
16. For `GET /oauth/installedLocations`, always include required query params `companyId` and `appId`; omitting `appId` causes `422 Unprocessable Entity`.
17. Parse installed-location response items using `_id` (not only `locationId`/`id`), or discovered locations will be incorrectly treated as empty.
18. Send `POST /oauth/locationToken` as `application/x-www-form-urlencoded` (`companyId`, `locationId`) to match current endpoint contract.
19. When multiple company tokens exist for a company (e.g., agency profile and primary profile), select the token that satisfies required scopes (`oauth.readonly`, `oauth.write`) for bulk discovery/mint operations.
20. In subaccount-target app model, set listing config to `Agency Only` + `Bulk Yes` when you need agency installers to get `userType=Company` consistently for bulk mint flow.
21. Add install-time mint completeness fields on the company-token row (for example: `installation_bulk_mint_complete`, `installation_bulk_mint_discovered`, `installation_bulk_mint_minted`, `installation_bulk_mint_failed`, retry-count/timestamp) and persist them in callback. Frontend must use this flag to hard-warn agency owners and expose a manual `re-mint all locations` action when install-time mint was incomplete.

## Validation Notes

Validated against live WEBHOST_SERVER-hosted MVP and logged-in GHL agency session:

- agency chooser UX currently presents subaccount selection (no separate agency install button observed)
- agency callback completed with `install_type=agency` and `company_id`
- pre-fix agency bulk discovery failed until `Version` header requirement was identified
- marketplace installation details for current draft app reports `userTypes=["Location"]`, which explains missing agency option and company-token limitations
- after switching subaccount app to `Agency Only` + `Bulk Yes`, agency install returned `userType=Company` and enabled successful mint to installed subaccounts
