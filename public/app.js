const authMessage = document.getElementById('authMessage');
const steamLoginBtn = document.getElementById('steamLoginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const libraryCard = document.getElementById('libraryCard');
const summaryCard = document.getElementById('summaryCard');
const listbox = document.getElementById('listbox');
const statusEl = document.getElementById('status');
const checkAll = document.getElementById('checkAll');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const summarySize = document.getElementById('summarySize');
const summaryMeta = document.getElementById('summaryMeta');
const reloadBtn = document.getElementById('reloadBtn');
const searchInput = document.getElementById('searchInput');

let games = [];
let filteredGames = [];
let selectedIds = new Set();

async function init() {
  const me = await fetchJson('/api/me');

  if (!me.authenticated) {
    authMessage.textContent = 'You are not logged in yet.';
    steamLoginBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    return;
  }

  authMessage.textContent = `Logged in as ${me.user.displayName}`;
  steamLoginBtn.classList.add('hidden');
  logoutBtn.classList.remove('hidden');

  libraryCard.classList.remove('hidden');
  summaryCard.classList.remove('hidden');

  await loadLibrary();
}

async function loadLibrary() {
  statusEl.textContent = 'Loading your Steam library and estimating disk size...';
  listbox.innerHTML = '';
  checkAll.checked = false;

  const payload = await fetchJson('/api/library');
  games = payload.games || [];
  filteredGames = games;
  selectedIds = new Set();

  renderList();
  updateSummary();

  const unknownCount = games.filter((game) => game.sizeMb === null).length;
  statusEl.textContent = `Loaded ${games.length} games. ${unknownCount} games have unknown size.`;
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();

  filteredGames = query
    ? games.filter((g) => g.name.toLowerCase().includes(query))
    : games;

  if (filteredGames.length === 0) {
    listbox.innerHTML = '<p class="status">No games match your filter.</p>';
    checkAll.checked = false;
    checkAll.indeterminate = false;
    return;
  }

  const rows = filteredGames
    .map((game) => {
      const checked = selectedIds.has(game.appid) ? 'checked' : '';
      return `
        <label class="game-row" data-appid="${game.appid}">
          <input type="checkbox" class="game-check" ${checked} />
          <span class="game-name" title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</span>
          <span class="game-size">${game.sizeLabel}</span>
        </label>
      `;
    })
    .join('');

  listbox.innerHTML = rows;
  updateCheckAllState();
}

function updateSummary() {
  let totalMb = 0;
  let selectedCount = 0;
  let unknownSelected = 0;

  for (const game of games) {
    if (!selectedIds.has(game.appid)) {
      continue;
    }

    selectedCount += 1;

    if (typeof game.sizeMb === 'number') {
      totalMb += game.sizeMb;
    } else {
      unknownSelected += 1;
    }
  }

  summarySize.textContent = formatTotal(totalMb);
  summaryMeta.textContent = `${selectedCount} games selected${
    unknownSelected ? ` (${unknownSelected} unknown)` : ''
  }`;
}

function updateCheckAllState() {
  const visibleIds = filteredGames.map((g) => g.appid);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id)).length;

  if (visibleIds.length === 0) {
    checkAll.checked = false;
    checkAll.indeterminate = false;
    return;
  }

  checkAll.checked = selectedVisible === visibleIds.length;
  checkAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
}

function formatTotal(totalMb) {
  if (totalMb >= 1024 * 1024) {
    return `${(totalMb / (1024 * 1024)).toFixed(2)} TB`;
  }

  if (totalMb >= 1024) {
    return `${(totalMb / 1024).toFixed(2)} GB`;
  }

  return `${Math.round(totalMb)} MB`;
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }

  return response.json();
}

listbox.addEventListener('change', (event) => {
  const target = event.target;

  if (!(target instanceof HTMLInputElement) || !target.classList.contains('game-check')) {
    return;
  }

  const row = target.closest('.game-row');
  const appid = Number(row?.dataset.appid);

  if (!appid) {
    return;
  }

  if (target.checked) {
    selectedIds.add(appid);
  } else {
    selectedIds.delete(appid);
  }

  updateCheckAllState();
  updateSummary();
});

checkAll.addEventListener('change', () => {
  for (const game of filteredGames) {
    if (checkAll.checked) {
      selectedIds.add(game.appid);
    } else {
      selectedIds.delete(game.appid);
    }
  }

  renderList();
  updateSummary();
});

clearSelectionBtn.addEventListener('click', () => {
  selectedIds.clear();
  renderList();
  updateSummary();
});

reloadBtn.addEventListener('click', async () => {
  await loadLibrary();
});

searchInput.addEventListener('input', () => {
  renderList();
});

logoutBtn.addEventListener('click', async () => {
  await fetchJson('/api/logout', { method: 'POST' });
  window.location.reload();
});

init().catch((err) => {
  console.error(err);
  statusEl.textContent = 'Failed to initialize app. Check server logs.';
});
