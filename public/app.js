async function loadJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  return data;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function findCompanyRow(state, companyId) {
  const rows = Array.isArray(state?.companyTokens) ? state.companyTokens : [];
  if (!rows.length) return null;
  if (companyId) return rows.find((row) => row.company_id === companyId) || null;
  return rows[rows.length - 1] || null;
}

function renderRemintControls(companyRow) {
  const remintBtn = document.getElementById('remint-all');
  const note = document.getElementById('remint-note');
  const installComplete = companyRow?.installation_bulk_mint_complete;
  const remintRequired = Boolean(companyRow?.remint_required);
  if (!companyRow) {
    remintBtn.classList.add('hidden');
    note.textContent = 'No company token loaded yet.';
    return;
  }
  if (installComplete === false || remintRequired) {
    remintBtn.classList.remove('hidden');
    note.textContent =
      `Installation minting was incomplete (${companyRow.installation_bulk_mint_minted || 0}/` +
      `${companyRow.installation_bulk_mint_discovered || 0}). Use Re-mint All Locations.`;
    return;
  }
  remintBtn.classList.add('hidden');
  if (installComplete === true) {
    note.textContent = 'Installation minting completed for all discovered locations.';
  } else {
    note.textContent = 'Installation mint status is not recorded yet.';
  }
}

async function refresh() {
  const [config, state] = await Promise.all([loadJson('/api/config'), loadJson('/api/state')]);
  document.getElementById('config').textContent = pretty(config);
  document.getElementById('state').textContent = pretty(state);
  const companyInput = document.getElementById('company-id');
  if (!companyInput.value) {
    companyInput.value =
      new URLSearchParams(window.location.search).get('company_id') ||
      state.companyTokens?.[state.companyTokens.length - 1]?.company_id ||
      '';
  }
  const activeCompany = findCompanyRow(state, companyInput.value.trim());
  renderRemintControls(activeCompany);
}

document.getElementById('start-install').addEventListener('click', () => {
  const returnTo = encodeURIComponent(window.location.origin + '/');
  window.location.href = `/oauth/install?installType=agency&returnTo=${returnTo}`;
});

document.getElementById('refresh').addEventListener('click', refresh);

document.getElementById('company-id').addEventListener('input', async () => {
  const state = await loadJson('/api/state');
  const companyId = document.getElementById('company-id').value.trim();
  renderRemintControls(findCompanyRow(state, companyId));
});

document.getElementById('remint-all').addEventListener('click', async () => {
  const companyId = document.getElementById('company-id').value.trim();
  if (!companyId) {
    window.alert('Provide companyId first.');
    return;
  }
  try {
    const result = await postJson('/api/agency/remint-all', { companyId });
    window.alert(
      `Re-mint complete. success=${result.bulkRetry?.success ? 'true' : 'false'} minted=${
        result.bulkRetry?.final?.minted || 0
      }/${result.bulkRetry?.final?.discovered || 0}`
    );
    await refresh();
  } catch (error) {
    window.alert(String(error.message || error));
  }
});

refresh().catch((error) => {
  document.getElementById('state').textContent = String(error);
});
