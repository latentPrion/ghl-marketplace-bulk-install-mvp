# GHL Marketplace Bulk-Install MVP

This repository is a working MVP for a **private GoHighLevel (GHL) marketplace app** focused on bulk installation behavior.

It models and tests installation/token behavior for:

- agency-level installation flow (company token path)
- subaccount-level installation flow (location token path)
- agency-driven bulk minting of location tokens for installed subaccounts
- retry/remint handling when bulk minting is incomplete

The purpose is to serve as a concrete reference implementation for integrating GHL marketplace install flows into a larger production codebase.

## Runtime

- Node.js backend + static frontend
- Dockerized deployment
- Designed to run on zambesii VPS at `http://zambesii.com:3210`

## Notes

- This is an MVP for flow validation and operational modeling, not a hardened production service.
- Secrets are expected in local env files (`dotenv.env`) and are intentionally gitignored.
