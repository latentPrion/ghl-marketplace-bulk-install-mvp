# Autobroker OAuth + Login-Related DB Schema (from live WEBHOST_SERVER-backed DB)

Generated from Supabase PostgREST OpenAPI via WEBHOST_SERVER on 2026-04-05T08:58:26.619Z.

## Notes

- OAuth installation tables used by backend: `ghl_oauth_tokens`, `ghl_oauth_location_tokens`.
- No dedicated `login`/`session` persistence table appears in the public schema.
- The closest user-login-adjacent table in DB is `portal_user_desking_mappings` (admin mapping data), not auth session storage.

## `ghl_oauth_tokens`

| Column | Type | Required | Nullable | Details |
|---|---|---|---|---|
| `id` | `string / uuid` | yes | no | Note:
This is a Primary Key.<pk/>; default="gen_random_uuid()" |
| `token_key` | `string / text` | yes | no |  |
| `company_id` | `string / text` | no | no |  |
| `access_token` | `string / text` | no | no |  |
| `access_expires_at` | `string / timestamp with time zone` | no | no |  |
| `refresh_token` | `string / text` | no | no |  |
| `refresh_token_id` | `string / text` | no | no |  |
| `scope` | `string / text` | no | no |  |
| `user_type` | `string / text` | no | no |  |
| `user_id` | `string / text` | no | no |  |
| `created_at` | `string / timestamp with time zone` | yes | no | default="now()" |
| `updated_at` | `string / timestamp with time zone` | yes | no | default="now()" |

## `ghl_oauth_location_tokens`

| Column | Type | Required | Nullable | Details |
|---|---|---|---|---|
| `id` | `string / uuid` | yes | no | Note:
This is a Primary Key.<pk/>; default="gen_random_uuid()" |
| `token_key` | `string / text` | yes | no |  |
| `location_id` | `string / text` | yes | no |  |
| `company_id` | `string / text` | no | no |  |
| `access_token` | `string / text` | yes | no |  |
| `access_expires_at` | `string / timestamp with time zone` | no | no |  |
| `created_at` | `string / timestamp with time zone` | yes | no | default="now()" |
| `updated_at` | `string / timestamp with time zone` | yes | no | default="now()" |

## `portal_user_desking_mappings`

| Column | Type | Required | Nullable | Details |
|---|---|---|---|---|
| `id` | `string / uuid` | yes | no | Note:
This is a Primary Key.<pk/>; default="gen_random_uuid()" |
| `location_id` | `string / text` | yes | no |  |
| `ui_origin` | `string / text` | yes | no | default="prod" |
| `ghl_user_id` | `string / text` | yes | no |  |
| `ghl_user_name` | `string / text` | no | no |  |
| `ghl_user_email` | `string / text` | no | no |  |
| `desk_user_id` | `string / text` | no | no |  |
| `rooftop_id` | `string / text` | no | no |  |
| `created_by_user_id` | `string / text` | no | no |  |
| `created_by_user_name` | `string / text` | no | no |  |
| `created_by_user_email` | `string / text` | no | no |  |
| `created_at` | `string / timestamp with time zone` | yes | no | default="now()" |
| `updated_at` | `string / timestamp with time zone` | yes | no | default="now()" |
| `desking_user_name` | `string / text` | yes | no |  |
| `is_active` | `boolean / boolean` | yes | no | default=true |
| `is_default` | `boolean / boolean` | yes | no | default=false |
| `updated_by_user_id` | `string / text` | no | no |  |
| `updated_by_user_name` | `string / text` | no | no |  |
| `updated_by_user_email` | `string / text` | no | no |  |
| `cardog_rooftop_id` | `string / text` | no | no |  |

## Public-schema tables matching `login/session/portal_user` pattern

- `portal_user_desking_mappings`
