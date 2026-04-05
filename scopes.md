# GHL Scopes

The install URLs in `dotenv.env` are the source of truth for the currently configured app scopes.

## Current Scope Set

| Scope | Required for | Endpoint families used by Autobroker |
|---|---|---|
| `users.readonly` | Portal session auth and owner or follower resolution | `GET /users` |
| `contacts.readonly` | Contact lookup and hydration | `GET /contacts`, `GET /contacts/:id` |
| `contacts.write` | Contact create or update and credit-score writes | `POST /contacts`, `PUT /contacts/:id` |
| `opportunities.readonly` | Opportunity reads and pipeline resolution | `GET /opportunities/:id`, `GET /opportunities/pipelines` |
| `opportunities.write` | Opportunity create, update, and delete | `POST /opportunities`, `PUT /opportunities/:id`, `DELETE /opportunities/:id` |
| `conversations/message.write` | Dealer room, stips, and outreach messaging via GHL | `POST /conversations/messages` |
| `locations.readonly` | Location lookup and install context reads | `GET /locations/:locationId` |
| `locations/customValues.readonly` | Custom value metadata reads | App-configured scope from install URL |
| `locations/customValues.write` | Custom value writes | App-configured scope from install URL |
| `medias.write` | Upload worksheet PDFs and other generated files into the location media library | `POST /medias/upload-file` |
| `objects/record.readonly` | Deal ledger and transaction object reads | `GET /objects/:schemaKey/records/:id`, `POST /objects/:schemaKey/records/search` |
| `objects/record.write` | Deal ledger object writes | `POST /objects/:schemaKey/records`, `PUT /objects/:schemaKey/records/:id` |
| `associations/relation.write` | Link opportunity to deal ledger object | `POST /associations/relations` |
| `invoices.write` | Outreach invoice create and send workflow | `POST /invoices`, `POST /invoices/:invoiceId/send` |
| `oauth.readonly` | Inspect installed locations and OAuth installation state | OAuth installation flows |
| `oauth.write` | Exchange auth codes and mint location tokens from company installs | OAuth installation flows |
| `marketplace-installer-details.readonly` | Fetch installer details after install | Marketplace install flows |

## Notes

- Trust the scopes embedded in the install URLs over older local notes.
- Previous references to `locations/customFields.readonly` and `locations/customFields.write` were stale for this app configuration.
- If the app configuration changes in HighLevel, regenerate or recopy the install URLs and then update this file to match them exactly.
