const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), 'dotenv.env'), override: false });
dotenv.config({ path: path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), '.env'), override: false });
dotenv.config({
  path: path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'dotenv.env'),
  override: false,
});

const app = express();

const PORT = Number(process.env.PORT || 3210);
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = process.env.GHL_OAUTH_REDIRECT_URI || `${APP_BASE_URL}/oauth/callback`;
const GHL_API_BASE_URL = process.env.GHL_API_BASE_URL || 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = process.env.GHL_API_VERSION || '2021-07-28';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'ghl-oauth-mvp-state.json');

const CLIENT_ID = (process.env.GHL_SUBACC_MARKETPLACE_APP_APP_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.GHL_SUBACC_MARKETPLACE_APP_APP_CLIENT_SECRET || '').trim();
const INSTALL_URL_STANDARD = (process.env.GHL_SUBACC_MARKETPLACE_APP_APP_INSTALL_URL_STANDARD || '').trim();
const INSTALL_URL_WHITE_LABEL = (process.env.GHL_SUBACC_MARKETPLACE_APP_APP_INSTALL_URL_WHITE_LABEL || '').trim();

const APP_ID = CLIENT_ID.split('-')[0] || null;
const BULK_MINT_RETRY_ATTEMPTS = Math.max(1, Number(process.env.BULK_MINT_RETRY_ATTEMPTS || 4));
const BULK_MINT_RETRY_DELAY_MS = Math.max(250, Number(process.env.BULK_MINT_RETRY_DELAY_MS || 3000));
const VERSION_ID = (() => {
  try {
    if (!INSTALL_URL_STANDARD) return null;
    return new URL(INSTALL_URL_STANDARD).searchParams.get('version_id');
  } catch {
    return null;
  }
})();
const SCOPES = (() => {
  try {
    if (!INSTALL_URL_STANDARD) return '';
    return new URL(INSTALL_URL_STANDARD).searchParams.get('scope') || '';
  } catch {
    return '';
  }
})();

const STATE_SECRET = process.env.OAUTH_STATE_SIGNING_SECRET || CLIENT_SECRET || 'unsafe-dev-secret';

if (!CLIENT_ID || !CLIENT_SECRET || !INSTALL_URL_STANDARD) {
  throw new Error(
    'Missing required subaccount app env vars: GHL_SUBACC_MARKETPLACE_APP_APP_CLIENT_ID, GHL_SUBACC_MARKETPLACE_APP_APP_CLIENT_SECRET, GHL_SUBACC_MARKETPLACE_APP_APP_INSTALL_URL_STANDARD'
  );
}

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function splitScopes(scope) {
  return String(scope || '')
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const companyTokens = (Array.isArray(parsed.companyTokens) ? parsed.companyTokens : []).map((row) => ({
      ...row,
      installation_bulk_mint_complete:
        typeof row?.installation_bulk_mint_complete === 'boolean'
          ? row.installation_bulk_mint_complete
          : null,
      installation_bulk_mint_attempted_at: row?.installation_bulk_mint_attempted_at || null,
      installation_bulk_mint_discovered:
        typeof row?.installation_bulk_mint_discovered === 'number'
          ? row.installation_bulk_mint_discovered
          : null,
      installation_bulk_mint_minted:
        typeof row?.installation_bulk_mint_minted === 'number' ? row.installation_bulk_mint_minted : null,
      installation_bulk_mint_failed:
        typeof row?.installation_bulk_mint_failed === 'number' ? row.installation_bulk_mint_failed : null,
      installation_bulk_mint_retry_attempts:
        typeof row?.installation_bulk_mint_retry_attempts === 'number'
          ? row.installation_bulk_mint_retry_attempts
          : null,
      remint_required: typeof row?.remint_required === 'boolean' ? row.remint_required : false,
      last_remint_attempt_at: row?.last_remint_attempt_at || null,
      last_remint_success: typeof row?.last_remint_success === 'boolean' ? row.last_remint_success : null,
    }));
    return {
      companyTokens,
      locationTokens: Array.isArray(parsed.locationTokens) ? parsed.locationTokens : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch {
    return { companyTokens: [], locationTokens: [], events: [] };
  }
}

function writeState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function recordEvent(type, details) {
  const state = readState();
  state.events.push({ id: crypto.randomUUID(), type, details: details || {}, created_at: nowIso() });
  if (state.events.length > 400) state.events = state.events.slice(-400);
  writeState(state);
}

function upsertCompanyToken(token, installType) {
  const state = readState();
  const companyId = normalizeText(token.company_id);
  if (!companyId) return null;
  const idx = state.companyTokens.findIndex(
    (row) => row.company_id === companyId && row.token_key === CLIENT_ID
  );
  const existing = idx >= 0 ? state.companyTokens[idx] : null;
  const row = {
    id: idx >= 0 ? state.companyTokens[idx].id : crypto.randomUUID(),
    token_key: CLIENT_ID,
    company_id: companyId,
    access_token: token.access_token,
    refresh_token: token.refresh_token || null,
    refresh_token_id: token.refresh_token_id || crypto.randomUUID(),
    scope: token.scope || '',
    user_type: token.user_type || null,
    user_id: token.user_id || null,
    access_expires_at: new Date(Date.now() + Number(token.expires_in || 0) * 1000).toISOString(),
    install_type: installType || 'agency',
    installation_bulk_mint_complete:
      existing && typeof existing.installation_bulk_mint_complete === 'boolean'
        ? existing.installation_bulk_mint_complete
        : null,
    installation_bulk_mint_attempted_at: existing?.installation_bulk_mint_attempted_at || null,
    installation_bulk_mint_discovered:
      typeof existing?.installation_bulk_mint_discovered === 'number'
        ? existing.installation_bulk_mint_discovered
        : null,
    installation_bulk_mint_minted:
      typeof existing?.installation_bulk_mint_minted === 'number'
        ? existing.installation_bulk_mint_minted
        : null,
    installation_bulk_mint_failed:
      typeof existing?.installation_bulk_mint_failed === 'number'
        ? existing.installation_bulk_mint_failed
        : null,
    installation_bulk_mint_retry_attempts:
      typeof existing?.installation_bulk_mint_retry_attempts === 'number'
        ? existing.installation_bulk_mint_retry_attempts
        : null,
    remint_required:
      existing && typeof existing.remint_required === 'boolean' ? existing.remint_required : false,
    last_remint_attempt_at: existing?.last_remint_attempt_at || null,
    last_remint_success:
      existing && typeof existing.last_remint_success === 'boolean' ? existing.last_remint_success : null,
    updated_at: nowIso(),
    created_at: idx >= 0 ? state.companyTokens[idx].created_at : nowIso(),
  };
  if (idx >= 0) state.companyTokens[idx] = row;
  else state.companyTokens.push(row);
  writeState(state);
  return row;
}

function updateCompanyTokenStatus(companyTokenId, patch) {
  const state = readState();
  const idx = state.companyTokens.findIndex((row) => row.id === companyTokenId);
  if (idx < 0) return null;
  state.companyTokens[idx] = {
    ...state.companyTokens[idx],
    ...patch,
    updated_at: nowIso(),
  };
  writeState(state);
  return state.companyTokens[idx];
}

function upsertLocationToken(token, locationId, companyId, installType, companyTokenId) {
  const state = readState();
  const normalizedLocationId = normalizeText(locationId || token.location_id);
  if (!normalizedLocationId) return null;
  const idx = state.locationTokens.findIndex(
    (row) => row.location_id === normalizedLocationId && row.token_key === CLIENT_ID
  );
  const row = {
    id: idx >= 0 ? state.locationTokens[idx].id : crypto.randomUUID(),
    token_key: CLIENT_ID,
    location_id: normalizedLocationId,
    company_id: normalizeText(companyId || token.company_id) || null,
    access_token: token.access_token,
    scope: token.scope || '',
    company_token_id: normalizeText(companyTokenId) || null,
    access_expires_at: new Date(Date.now() + Number(token.expires_in || 0) * 1000).toISOString(),
    install_type: installType || 'agency_bulk',
    updated_at: nowIso(),
    created_at: idx >= 0 ? state.locationTokens[idx].created_at : nowIso(),
  };
  if (idx >= 0) state.locationTokens[idx] = row;
  else state.locationTokens.push(row);
  writeState(state);
  return row;
}

function purgeInvalidLocationTokenLinks(newCompanyTokenRow) {
  const state = readState();
  const companyRows = (state.companyTokens || []).filter((row) => row.token_key === CLIENT_ID);
  const byId = new Map(companyRows.map((row) => [row.id, row]));
  const before = (state.locationTokens || []).length;
  const beforeForApp = (state.locationTokens || []).filter((row) => row.token_key === CLIENT_ID).length;
  let deletedOrphanFk = 0;
  let deletedWrongCompanyLink = 0;
  let deletedInvalidParentToken = 0;

  const isStructurallyValidAccessToken = (value) => {
    const token = normalizeText(value);
    if (!token) return false;
    return token.split('.').length >= 3;
  };

  state.locationTokens = (state.locationTokens || []).filter((row) => {
    if (row.token_key !== CLIENT_ID) return true;
    const fk = normalizeText(row.company_token_id);
    if (!fk) {
      deletedOrphanFk += 1;
      return false;
    }
    const parent = byId.get(fk);
    if (!parent) {
      deletedOrphanFk += 1;
      return false;
    }
    if (!isStructurallyValidAccessToken(parent.access_token)) {
      deletedInvalidParentToken += 1;
      return false;
    }
    const keep = parent.id === newCompanyTokenRow.id && parent.company_id === newCompanyTokenRow.company_id;
    if (!keep) deletedWrongCompanyLink += 1;
    return keep;
  });

  const after = state.locationTokens.length;
  const afterForApp = state.locationTokens.filter((row) => row.token_key === CLIENT_ID).length;
  writeState(state);
  return {
    beforeTotal: before,
    afterTotal: after,
    deletedTotal: before - after,
    beforeForApp,
    afterForApp,
    deletedForApp: beforeForApp - afterForApp,
    deletedOrphanFk,
    deletedWrongCompanyLink,
    deletedInvalidParentToken,
    targetCompanyId: newCompanyTokenRow.company_id,
    targetCompanyTokenId: newCompanyTokenRow.id,
  };
}

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(raw) {
  const [body, sig] = String(raw || '').split('.');
  if (!body || !sig) throw new Error('invalid state format');
  const expected = crypto.createHmac('sha256', STATE_SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('invalid state signature');
  }
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

async function parseJson(res) {
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function parseTokenResponse(payload) {
  const accessToken = normalizeText(payload.access_token);
  if (!accessToken) throw new Error('Missing access token');
  return {
    access_token: accessToken,
    refresh_token: normalizeText(payload.refresh_token),
    expires_in: Number(payload.expires_in || 0),
    scope: normalizeText(payload.scope) || '',
    user_type: normalizeText(payload.userType || payload.user_type),
    user_id: normalizeText(payload.userId || payload.user_id),
    company_id: normalizeText(payload.companyId || payload.company_id),
    location_id: normalizeText(payload.locationId || payload.location_id),
    refresh_token_id: normalizeText(payload.refreshTokenId || payload.refresh_token_id),
  };
}

async function exchangeCodeForToken(code, userType) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
  });
  if (normalizeText(userType)) params.set('user_type', userType);
  const res = await fetch(`${GHL_API_BASE_URL}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const payload = await parseJson(res);
  if (!res.ok) throw new Error(`Code exchange failed (${res.status}): ${payload.message || payload.error || 'unknown'}`);
  return parseTokenResponse(payload);
}

async function getInstalledLocations(companyAccessToken, companyId) {
  const url = new URL(`${GHL_API_BASE_URL}/oauth/installedLocations`);
  url.searchParams.set('companyId', companyId);
  url.searchParams.set('appId', APP_ID || '');
  url.searchParams.set('limit', '100');
  url.searchParams.set('skip', '0');
  if (VERSION_ID) url.searchParams.set('versionId', VERSION_ID);
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${companyAccessToken}`,
      Version: GHL_API_VERSION,
    },
  });
  const payload = await parseJson(res);
  if (!res.ok) throw new Error(`Installed locations failed (${res.status}): ${payload.message || payload.error || 'unknown'}`);
  const rows = Array.isArray(payload.locations) ? payload.locations : [];
  return {
    locationIds: rows
      .map((row) => normalizeText(row.locationId || row.location_id || row._id || row.id))
      .filter(Boolean),
    installToFutureLocations: Boolean(payload.installToFutureLocations),
    reportedCount: Number(payload.count || rows.length),
  };
}

async function mintLocationToken(companyAccessToken, companyId, locationId) {
  const body = new URLSearchParams({ companyId, locationId }).toString();
  const res = await fetch(`${GHL_API_BASE_URL}/oauth/locationToken`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${companyAccessToken}`,
      Version: GHL_API_VERSION,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await parseJson(res);
  if (!res.ok) throw new Error(`Location mint failed (${res.status}): ${payload.message || payload.error || 'unknown'}`);
  return parseTokenResponse(payload);
}

async function runBulkMint(companyTokenRow, companyId) {
  const installed = await getInstalledLocations(companyTokenRow.access_token, companyId);
  const result = {
    discovered: installed.locationIds.length,
    minted: 0,
    failed: [],
    installToFutureLocations: installed.installToFutureLocations,
    reportedCount: installed.reportedCount,
  };
  for (const locationId of installed.locationIds) {
    try {
      const token = await mintLocationToken(companyTokenRow.access_token, companyId, locationId);
      upsertLocationToken(token, locationId, companyId, 'agency_bulk', companyTokenRow.id);
      result.minted += 1;
    } catch (error) {
      result.failed.push({ locationId, error: error.message });
    }
  }
  return result;
}

async function runBulkMintWithRetry(companyTokenRow, companyId, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || BULK_MINT_RETRY_ATTEMPTS));
  const delayMs = Math.max(250, Number(options.delayMs || BULK_MINT_RETRY_DELAY_MS));
  const runs = [];
  let last = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const run = await runBulkMint(companyTokenRow, companyId);
    const failedCount = Array.isArray(run.failed) ? run.failed.length : 0;
    const success = run.discovered === 0 || failedCount === 0;
    const snapshot = { attempt, success, ...run };
    runs.push(snapshot);
    last = snapshot;
    if (success) {
      return {
        ok: true,
        success: true,
        attempts,
        delayMs,
        runs,
        final: snapshot,
      };
    }
    if (attempt < attempts) await sleep(delayMs);
  }

  return {
    ok: false,
    success: false,
    attempts,
    delayMs,
    runs,
    final: last,
  };
}

async function processInstallEvent(event) {
  const type = normalizeText(event?.type)?.toUpperCase();
  const companyId = normalizeText(event?.companyId || event?.company_id);
  const locationId = normalizeText(event?.locationId || event?.location_id);
  const appId = normalizeText(event?.appId || event?.app_id);
  if (type !== 'INSTALL' || !companyId || !locationId) {
    return { ok: true, ignored: true };
  }
  if (appId && APP_ID && appId !== APP_ID) {
    return { ok: true, ignored: true, reason: 'app_id_mismatch' };
  }
  const row = readState().companyTokens.find(
    (item) => item.company_id === companyId && item.token_key === CLIENT_ID
  );
  if (!row) {
    return { ok: true, ignored: true, reason: 'company_token_missing' };
  }
  const token = await mintLocationToken(row.access_token, companyId, locationId);
  upsertLocationToken(token, locationId, companyId, 'webhook_install', row.id);
  recordEvent('webhook_install_mint_success', { companyId, locationId });
  return { ok: true, minted: true, companyId, locationId };
}

function buildInstallUrl({ useWhiteLabel, returnTo }) {
  const source = useWhiteLabel ? INSTALL_URL_WHITE_LABEL : INSTALL_URL_STANDARD;
  if (!source) throw new Error('Missing install URL in env');
  const base = new URL(source);
  const out = new URL(base.pathname, base.origin);
  for (const [k, v] of base.searchParams.entries()) out.searchParams.set(k, v);
  out.searchParams.set('response_type', 'code');
  out.searchParams.set('client_id', CLIENT_ID);
  out.searchParams.set('redirect_uri', REDIRECT_URI);
  if (SCOPES) out.searchParams.set('scope', SCOPES);
  if (VERSION_ID) out.searchParams.set('version_id', VERSION_ID);
  out.searchParams.set(
    'state',
    signState({
      installType: 'agency',
      returnTo: returnTo || null,
      iat: Math.floor(Date.now() / 1000),
    })
  );
  return out.toString();
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));

app.get('/health', (_req, res) => res.json({ ok: true, now: nowIso() }));

app.get('/api/config', (_req, res) => {
  res.json({
    appBaseUrl: APP_BASE_URL,
    redirectUri: REDIRECT_URI,
    clientId: CLIENT_ID,
    appId: APP_ID,
    versionId: VERSION_ID,
    scopes: SCOPES,
    ghlApiVersion: GHL_API_VERSION,
    profile: 'subaccount-target agency-only bulk',
  });
});

app.get('/api/state', (_req, res) => {
  const state = readState();
  res.json(state);
});

app.get('/oauth/install', (req, res) => {
  try {
    const returnTo = normalizeText(req.query.returnTo || req.query.return_to);
    const useWhiteLabel = ['1', 'true', 'yes'].includes(String(req.query.whiteLabel || '').toLowerCase());
    res.redirect(buildInstallUrl({ useWhiteLabel, returnTo }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/oauth/callback', async (req, res) => {
  try {
    const code = normalizeText(req.query.code);
    if (!code) {
      res.status(400).json({ error: 'Missing code' });
      return;
    }
    const rawState = normalizeText(req.query.state);
    let parsedState = null;
    if (rawState) parsedState = verifyState(rawState);

    const queryInstallType = normalizeText(req.query.installType || req.query.install_type);
    const queryLocationId = normalizeText(req.query.locationId || req.query.location_id);
    const hintedInstallType = normalizeText(parsedState?.installType || queryInstallType);
    const token = await exchangeCodeForToken(
      code,
      hintedInstallType === 'agency' ? 'Company' : hintedInstallType === 'location' ? 'Location' : null
    );

    const tokenCompanyId = normalizeText(token.company_id);
    const tokenLocationId = normalizeText(token.location_id);
    const tokenUserType = normalizeText(token.user_type)?.toLowerCase();
    const shouldHandleAsAgency =
      tokenUserType === 'company' ||
      (!queryLocationId && tokenCompanyId && !tokenLocationId);

    if (shouldHandleAsAgency) {
      const companyId = tokenCompanyId;
      if (!companyId) {
        res.status(502).json({ error: 'Missing company_id in token response' });
        return;
      }

      const companyRow = upsertCompanyToken(token, 'agency');
      if (!companyRow) {
        res.status(502).json({ error: 'Failed to persist company token row' });
        return;
      }
      const purge = purgeInvalidLocationTokenLinks(companyRow);
      const bulkRetry = await runBulkMintWithRetry(companyRow, companyId);
      const finalDiscovered = Number(bulkRetry.final?.discovered || 0);
      const finalMinted = Number(bulkRetry.final?.minted || 0);
      const finalFailed = Array.isArray(bulkRetry.final?.failed) ? bulkRetry.final.failed.length : 0;
      updateCompanyTokenStatus(companyRow.id, {
        installation_bulk_mint_complete: bulkRetry.success,
        installation_bulk_mint_attempted_at: nowIso(),
        installation_bulk_mint_discovered: finalDiscovered,
        installation_bulk_mint_minted: finalMinted,
        installation_bulk_mint_failed: finalFailed,
        installation_bulk_mint_retry_attempts: Number(bulkRetry.runs?.length || 0),
        remint_required: !bulkRetry.success,
        last_remint_attempt_at: null,
        last_remint_success: null,
      });
      recordEvent('oauth_callback_agency_success', {
        companyId,
        tokenUserType: token.user_type,
        companyTokenId: companyRow.id,
        purge,
        bulkRetry,
        stateless: !rawState,
      });

      const returnTo = normalizeText(parsedState?.returnTo);
      const target = returnTo ? new URL(returnTo) : new URL(`${APP_BASE_URL}/`);
      target.searchParams.set('connected', '1');
      target.searchParams.set('install_type', 'agency');
      target.searchParams.set('company_id', companyId);
      target.searchParams.set('bulk_discovered', String(bulkRetry.final?.discovered || 0));
      target.searchParams.set('bulk_minted', String(bulkRetry.final?.minted || 0));
      target.searchParams.set('bulk_retry_success', bulkRetry.success ? '1' : '0');
      res.redirect(target.toString());
      return;
    }

    const locationId = normalizeText(parsedState?.locationId || queryLocationId || tokenLocationId);
    if (!locationId) {
      res.status(502).json({ error: 'Missing location_id in token response' });
      return;
    }
    upsertLocationToken(token, locationId, tokenCompanyId, 'location', null);
    recordEvent('oauth_callback_location_success', {
      locationId,
      companyId: tokenCompanyId,
      tokenUserType: token.user_type,
      stateless: !rawState,
    });

    const returnTo = normalizeText(parsedState?.returnTo);
    if (returnTo) {
      const url = new URL(returnTo);
      url.searchParams.set('connected', '1');
      url.searchParams.set('install_type', 'location');
      url.searchParams.set('location_id', locationId);
      if (tokenCompanyId) url.searchParams.set('company_id', tokenCompanyId);
      res.redirect(url.toString());
      return;
    }
    res
      .status(200)
      .type('text/html')
      .send(
        `<!doctype html><html><head><meta charset="utf-8" /><title>Connected</title></head><body style="font-family: ui-sans-serif, system-ui; padding: 24px;"><h2>Subaccount connected</h2><p>Location <code>${locationId}</code> is now connected.</p><p>If this opened in a new window or tab, close it and return to the app.</p></body></html>`
      );
  } catch (error) {
    recordEvent('oauth_callback_error', { error: error.message });
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/agency/installed-locations', async (req, res) => {
  try {
    const companyId = normalizeText(req.query.companyId || req.query.company_id);
    if (!companyId) {
      res.status(400).json({ error: 'companyId is required' });
      return;
    }
    const row = readState().companyTokens.find(
      (item) => item.company_id === companyId && item.token_key === CLIENT_ID
    );
    if (!row) {
      res.status(404).json({ error: 'No company token found for this app/company' });
      return;
    }
    const installed = await getInstalledLocations(row.access_token, companyId);
    res.json({ ok: true, companyId, ...installed });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/agency/sync-locations', async (req, res) => {
  try {
    const companyId = normalizeText(req.body.companyId || req.body.company_id);
    if (!companyId) {
      res.status(400).json({ error: 'companyId is required' });
      return;
    }
    const row = readState().companyTokens.find(
      (item) => item.company_id === companyId && item.token_key === CLIENT_ID
    );
    if (!row) {
      res.status(404).json({ error: 'No company token found for this app/company' });
      return;
    }
    const bulkRetry = await runBulkMintWithRetry(row, companyId, {
      attempts: req.body.attempts,
      delayMs: req.body.delayMs,
    });
    const updated = updateCompanyTokenStatus(row.id, {
      remint_required: !bulkRetry.success,
      last_remint_attempt_at: nowIso(),
      last_remint_success: bulkRetry.success,
    });
    recordEvent('agency_manual_sync', { companyId, bulkRetry });
    res.json({ ok: true, companyId, bulkRetry, companyToken: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/agency/remint-all', async (req, res) => {
  try {
    const companyId = normalizeText(req.body.companyId || req.body.company_id);
    if (!companyId) {
      res.status(400).json({ error: 'companyId is required' });
      return;
    }
    const row = readState().companyTokens.find(
      (item) => item.company_id === companyId && item.token_key === CLIENT_ID
    );
    if (!row) {
      res.status(404).json({ error: 'No company token found for this app/company' });
      return;
    }
    const purge = purgeInvalidLocationTokenLinks(row);
    const bulkRetry = await runBulkMintWithRetry(row, companyId, {
      attempts: req.body.attempts,
      delayMs: req.body.delayMs,
    });
    const updated = updateCompanyTokenStatus(row.id, {
      remint_required: !bulkRetry.success,
      last_remint_attempt_at: nowIso(),
      last_remint_success: bulkRetry.success,
    });
    recordEvent('agency_manual_remint', { companyId, purge, bulkRetry });
    res.json({ ok: true, companyId, purge, bulkRetry, companyToken: updated });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/webhooks/ghl/app-install', async (req, res) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const results = [];
  for (const event of events) {
    try {
      results.push(await processInstallEvent(event));
    } catch (error) {
      results.push({ ok: false, error: error.message });
    }
  }
  res.json({ ok: true, processed: results.length, results });
});

app.post('/api/debug/simulate-app-install', async (req, res) => {
  try {
    const payload = {
      type: 'INSTALL',
      appId: APP_ID,
      companyId: req.body.companyId || req.body.company_id || null,
      locationId: req.body.locationId || req.body.location_id || null,
    };
    const result = await processInstallEvent(payload);
    res.json({ ok: true, payload, result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.listen(PORT, () => {
  recordEvent('server_start', { port: PORT, appId: APP_ID, versionId: VERSION_ID });
  // eslint-disable-next-line no-console
  console.log(`MVP listening on ${PORT}`);
});
