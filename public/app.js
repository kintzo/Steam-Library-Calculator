const authMessage = document.getElementById('authMessage');
const steamLoginBtn = document.getElementById('steamLoginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const backBtn = document.getElementById('backBtn');
const steamIdForm = document.getElementById('steamIdForm');
const steamIdInput = document.getElementById('steamIdInput');
const loadByIdBtn = document.getElementById('loadByIdBtn');
const libraryCard = document.getElementById('libraryCard');
const summaryCard = document.getElementById('summaryCard');
const comparisonForm = document.getElementById('comparisonForm');
const comparisonInput = document.getElementById('comparisonInput');
const loadedUsers = document.getElementById('loadedUsers');
const listbox = document.getElementById('listbox');
const statusEl = document.getElementById('status');
const checkAll = document.getElementById('checkAll');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const summarySize = document.getElementById('summarySize');
const summaryMeta = document.getElementById('summaryMeta');
const summaryStackedSize = document.getElementById('summaryStackedSize');
const summarySharedCount = document.getElementById('summarySharedCount');
const summaryLibraryCount = document.getElementById('summaryLibraryCount');
const reloadBtn = document.getElementById('reloadBtn');
const searchInput = document.getElementById('searchInput');
const unknownFilterRadios = document.querySelectorAll('input[name="unknownFilter"]');
const ownershipFilterRadios = document.querySelectorAll('input[name="ownershipFilter"]');
const sharedPlayersFieldset = document.getElementById('sharedPlayersFieldset');
const sharedPlayersContainer = document.getElementById('sharedPlayersContainer');

const GUEST_STEAM_ID_KEY = 'guestSteamId';
const COMPARE_STEAM_IDS_KEY = 'comparisonSteamIds';

let games = [];
let filteredGames = [];
let selectedIds = new Set();
let sharedPlayerSteamIds = new Set();
let isGuest = false;
let guestSteamId = null;
let customSizes = new Map();
let libraries = [];
let currentUser = null;

function formatSizeMb(sizeMb) {
  if (sizeMb === null || sizeMb === undefined) {
    return 'Unknown';
  }

  if (sizeMb >= 1024 * 1024) {
    return `${(sizeMb / (1024 * 1024)).toFixed(2)} TB`;
  }

  if (sizeMb >= 1024) {
    return `${(sizeMb / 1024).toFixed(2)} GB`;
  }

  return `${Math.round(sizeMb)} MB`;
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
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function getInitials(text) {
  return String(text)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

function setStatus(message) {
  statusEl.textContent = message;
}

function getStoredComparisonIds() {
  try {
    const value = sessionStorage.getItem(COMPARE_STEAM_IDS_KEY);
    if (!value) {
      return [];
    }

    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function setStoredComparisonIds(ids) {
  sessionStorage.setItem(COMPARE_STEAM_IDS_KEY, JSON.stringify(ids));
}

function getComparisonIds() {
  return libraries
    .filter((library) => library.source === 'comparison')
    .map((library) => library.steamId);
}

function applyCustomSizes(gameList) {
  for (const game of gameList) {
    const customMb = customSizes.get(String(game.appid));
    if (customMb !== undefined) {
      game.sizeMb = customMb;
      game.sizeLabel = formatSizeMb(customMb);
      game.sizeSource = 'user_provided';
    }
  }
}

async function loadCustomSizes() {
  try {
    const sizes = await fetchJson('api/customSizes');
    customSizes = new Map(Object.entries(sizes));
  } catch (error) {
    console.warn('Failed to load custom sizes:', error);
  }
}

async function saveCustomSize(appid, sizeMb) {
  try {
    await fetchJson('api/customSizes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid: String(appid), sizeMb })
    });
    customSizes.set(String(appid), sizeMb);
  } catch (error) {
    console.warn('Failed to save custom size:', error);
  }
}

function setAuthenticatedUi() {
  authMessage.textContent = `Logged in as ${currentUser.displayName}`;
  steamLoginBtn.classList.add('hidden');
  steamIdForm.classList.add('hidden');
  logoutBtn.classList.remove('hidden');
  backBtn.classList.add('hidden');
  libraryCard.classList.remove('hidden');
  summaryCard.classList.remove('hidden');
}

function setGuestUi(steamId) {
  authMessage.textContent = `Loaded library for Steam ID: ${steamId}`;
  steamLoginBtn.classList.add('hidden');
  steamIdForm.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  backBtn.classList.remove('hidden');
  libraryCard.classList.remove('hidden');
  summaryCard.classList.remove('hidden');
}

function setLoggedOutUi() {
  authMessage.textContent = 'You are not logged in yet.';
  steamLoginBtn.classList.remove('hidden');
  steamIdForm.classList.remove('hidden');
  logoutBtn.classList.add('hidden');
  backBtn.classList.add('hidden');
  libraryCard.classList.add('hidden');
  summaryCard.classList.add('hidden');
  libraries = [];
  games = [];
  filteredGames = [];
  selectedIds.clear();
  loadedUsers.innerHTML = '';
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }

  return response.json();
}

async function fetchLibrary(steamId) {
  const url = steamId ? `api/library?steamId=${encodeURIComponent(steamId)}` : 'api/library';
  const payload = await fetchJson(url);

  if (!payload || !Array.isArray(payload.games)) {
    throw new Error('Invalid library response from server');
  }

  applyCustomSizes(payload.games);

  return {
    steamId: payload.owner?.steamId || payload.steamId,
    requestedAs: payload.requestedAs || steamId || payload.owner?.steamId || payload.steamId,
    displayName: payload.owner?.displayName || payload.owner?.steamId || 'Steam User',
    avatar: payload.owner?.avatar || null,
    totalGames: payload.totalGames || payload.games.length,
    games: payload.games,
    source: steamId ? 'comparison' : 'self'
  };
}

function buildAggregateGames(nextLibraries) {
  const gameMap = new Map();

  for (const library of nextLibraries) {
    for (const game of library.games) {
      const existing = gameMap.get(game.appid);
      if (!existing) {
        gameMap.set(game.appid, {
          ...game,
          owners: [library.displayName],
          ownerSteamIds: [library.steamId]
        });
        continue;
      }

      existing.owners.push(library.displayName);
      existing.ownerSteamIds.push(library.steamId);

      if (existing.sizeMb === null && typeof game.sizeMb === 'number') {
        existing.sizeMb = game.sizeMb;
        existing.sizeLabel = game.sizeLabel;
        existing.sizeSource = game.sizeSource;
      }
    }
  }

  return [...gameMap.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function updateLoadedUsers() {
  if (libraries.length === 0) {
    loadedUsers.innerHTML = '<p class="status">No libraries loaded.</p>';
    return;
  }

  loadedUsers.innerHTML = libraries
    .map((library) => {
      const avatar = library.avatar
        ? `<img src="${escapeHtml(library.avatar)}" alt="${escapeHtml(library.displayName)}" />`
        : `<span class="user-pill-avatar">${escapeHtml(getInitials(library.displayName))}</span>`;
      const subtitle = library.source === 'comparison'
        ? `${library.totalGames} games`
        : `${library.totalGames} games · base library`;
      const action = library.source === 'comparison'
        ? `<button class="user-pill-remove" data-steamid="${escapeHtml(library.steamId)}" type="button">Remove</button>`
        : '';

      return `
        <div class="user-pill">
          ${avatar}
          <div class="user-pill-meta">
            <span class="user-pill-name">${escapeHtml(library.displayName)}</span>
            <span class="user-pill-subtitle">${escapeHtml(subtitle)}</span>
          </div>
          ${action}
        </div>
      `;
    })
    .join('');
}

function updateSharedPlayersFilter() {
  // Create checkboxes for each loaded library
  if (libraries.length <= 1) {
    // No point filtering by players if only 1 library
    sharedPlayersFieldset.classList.add('invisible');
    sharedPlayerSteamIds.clear();
    return;
  }

  sharedPlayersContainer.innerHTML = libraries
    .map((library) => {
      const isChecked = sharedPlayerSteamIds.has(library.steamId) ? 'checked' : '';
      return `
        <label class="checkbox-row">
          <input type="checkbox" class="shared-player-check" data-steamid="${escapeHtml(library.steamId)}" ${isChecked} />
          <span>${escapeHtml(library.displayName)}</span>
        </label>
      `;
    })
    .join('');

  // If "shared" filter is active, show the player selection; otherwise hide it
  const ownershipMode = [...ownershipFilterRadios].find((radio) => radio.checked)?.value || 'all';
  if (ownershipMode === 'shared') {
    sharedPlayersFieldset.classList.remove('invisible');
  }
}

function replaceLibraries(nextLibraries) {
  libraries = nextLibraries;
  games = buildAggregateGames(libraries);
  filteredGames = games;
  selectedIds = new Set([...selectedIds].filter((appid) => games.some((game) => game.appid === appid)));
  renderList();
  updateSummary();
  updateLoadedUsers();
  updateSharedPlayersFilter();
}

function buildStatusMessage(errors = []) {
  const unknownCount = games.filter((game) => game.sizeMb === null).length;
  const sharedCount = games.filter((game) => game.owners.length > 1).length;
  let message = `Loaded ${games.length} distinct games across ${libraries.length} libraries. ${sharedCount} shared titles. ${unknownCount} games have unknown size.`;

  if (errors.length > 0) {
    message += ` Failed to load: ${errors.join(', ')}.`;
  }

  message += ' Steam Web API excludes shared family library items and may omit unplayed free-to-play titles.';
  return message;
}

async function initializeLibraries() {
  try {
    setStatus('Loading Steam libraries and estimating disk size...');
    listbox.innerHTML = '';
    checkAll.checked = false;

    const baseLibrary = isGuest ? await fetchLibrary(guestSteamId) : await fetchLibrary();
    if (isGuest) {
      baseLibrary.source = 'guest';
      guestSteamId = baseLibrary.steamId;
      sessionStorage.setItem(GUEST_STEAM_ID_KEY, guestSteamId);
      setGuestUi(guestSteamId);
    }

    const comparisonIds = [...new Set(getStoredComparisonIds())].filter((steamId) => steamId !== baseLibrary.steamId);
    const comparisonResults = await Promise.allSettled(comparisonIds.map((steamId) => fetchLibrary(steamId)));
    const comparisonLibraries = [];
    const failedLibraries = [];

    for (const [index, result] of comparisonResults.entries()) {
      if (result.status === 'fulfilled') {
        const library = result.value;
        library.source = 'comparison';

        if (!comparisonLibraries.some((entry) => entry.steamId === library.steamId) && library.steamId !== baseLibrary.steamId) {
          comparisonLibraries.push(library);
        }
      } else {
        failedLibraries.push(comparisonIds[index]);
      }
    }

    setStoredComparisonIds(comparisonLibraries.map((library) => library.steamId));
    replaceLibraries([baseLibrary, ...comparisonLibraries]);
    setStatus(buildStatusMessage(failedLibraries));
  } catch (error) {
    console.error('initializeLibraries error', error);
    setStatus(`Failed to load library: ${error.message || 'Unknown error'}`);
    throw error;
  }
}

function renderList() {
  const query = searchInput.value.trim().toLowerCase();
  const unknownMode = [...unknownFilterRadios].find((radio) => radio.checked)?.value || 'all';
  const ownershipMode = [...ownershipFilterRadios].find((radio) => radio.checked)?.value || 'all';

  filteredGames = games.filter((game) => {
    if (query && !game.name.toLowerCase().includes(query)) {
      return false;
    }

    if (unknownMode === 'hide' && game.sizeMb === null) {
      return false;
    }

    if (unknownMode === 'only' && game.sizeMb !== null) {
      return false;
    }

    if (ownershipMode === 'shared' && game.owners.length < 2) {
      return false;
    }

    if (ownershipMode === 'exclusive' && game.owners.length !== 1) {
      return false;
    }

    // Filter by selected shared players if in "shared" mode and players are selected
    if (ownershipMode === 'shared' && sharedPlayerSteamIds.size > 0) {
      // Only show games owned by ALL selected players
      const gameOwnerIds = new Set(game.ownerSteamIds || []);
      const allSelectedOwned = [...sharedPlayerSteamIds].every((steamId) => gameOwnerIds.has(steamId));
      if (!allSelectedOwned) {
        return false;
      }
    }

    return true;
  });

  if (filteredGames.length === 0) {
    listbox.innerHTML = '<p class="status">No games match your filter.</p>';
    checkAll.checked = false;
    checkAll.indeterminate = false;
    return;
  }

  listbox.innerHTML = filteredGames
    .map((game) => {
      const checked = selectedIds.has(game.appid) ? 'checked' : '';
      const thumbHtml = game.thumbnailUrl
        ? `<img src="${escapeHtml(game.thumbnailUrl)}" alt="${escapeHtml(game.name)}" class="game-thumb" />`
        : '';
      const sizeClass = game.sizeMb === null ? 'game-size game-size-unknown' : 'game-size';
      const ownerBadges = game.owners
        .map((owner) => `<span class="owner-badge">${escapeHtml(owner)}</span>`)
        .join('');

      return `
        <label class="game-row" data-appid="${game.appid}">
          <input type="checkbox" class="game-check" ${checked} />
          <div class="game-thumb-container">${thumbHtml}</div>
          <span class="game-name" title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</span>
          <div class="game-owners">${ownerBadges}</div>
          <span class="${sizeClass}" data-appid="${game.appid}">${game.sizeLabel}</span>
        </label>
      `;
    })
    .join('');

  updateCheckAllState();
}

function updateSummary() {
  let uniqueTotalMb = 0;
  let stackedTotalMb = 0;
  let selectedCount = 0;
  let unknownSelected = 0;
  let sharedSelected = 0;

  for (const game of games) {
    if (!selectedIds.has(game.appid)) {
      continue;
    }

    selectedCount += 1;

    if (typeof game.sizeMb === 'number') {
      uniqueTotalMb += game.sizeMb;
      stackedTotalMb += game.sizeMb * game.owners.length;
    } else {
      unknownSelected += 1;
    }

    if (game.owners.length > 1) {
      sharedSelected += 1;
    }
  }

  summarySize.textContent = formatTotal(uniqueTotalMb);
  summaryMeta.textContent = `${selectedCount} titles selected${
    unknownSelected ? ` (${unknownSelected} unknown)` : ''
  }`;
  summaryStackedSize.textContent = formatTotal(stackedTotalMb);
  summarySharedCount.textContent = String(sharedSelected);
  summaryLibraryCount.textContent = String(libraries.length);
}

function updateCheckAllState() {
  const visibleIds = filteredGames.map((game) => game.appid);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id)).length;

  if (visibleIds.length === 0) {
    checkAll.checked = false;
    checkAll.indeterminate = false;
    return;
  }

  checkAll.checked = selectedVisible === visibleIds.length;
  checkAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleIds.length;
}

async function init() {
  await loadCustomSizes();

  const me = await fetchJson('api/me');
  if (me.authenticated) {
    currentUser = me.user;
    isGuest = false;
    guestSteamId = null;
    sessionStorage.removeItem(GUEST_STEAM_ID_KEY);
    setAuthenticatedUi();
    await initializeLibraries();
    return;
  }

  const storedGuestId = sessionStorage.getItem(GUEST_STEAM_ID_KEY);
  if (storedGuestId) {
    isGuest = true;
    guestSteamId = storedGuestId;
    setGuestUi(guestSteamId);
    await initializeLibraries();
    return;
  }

  setLoggedOutUi();
}

listbox.addEventListener('click', async (event) => {
  const target = event.target;
  if (!target.classList.contains('game-size-unknown')) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const appid = Number(target.dataset.appid);
  const game = games.find((entry) => entry.appid === appid);
  if (!game) {
    return;
  }

  const input = prompt(`Enter size for "${game.name}" in GB (e.g., 5.2):`);
  if (input === null) {
    return;
  }

  const gb = parseFloat(input.trim());
  if (Number.isNaN(gb) || gb < 0) {
    alert('Invalid input. Please enter a number in GB.');
    return;
  }

  const mb = Math.round(gb * 1024);
  await saveCustomSize(appid, mb);

  for (const entry of games) {
    if (entry.appid === appid) {
      entry.sizeMb = mb;
      entry.sizeLabel = formatSizeMb(mb);
      entry.sizeSource = 'user_provided';
    }
  }

  for (const library of libraries) {
    for (const libraryGame of library.games) {
      if (libraryGame.appid === appid) {
        libraryGame.sizeMb = mb;
        libraryGame.sizeLabel = formatSizeMb(mb);
        libraryGame.sizeSource = 'user_provided';
      }
    }
  }

  renderList();
  updateSummary();
  setStatus(buildStatusMessage());
});

listbox.addEventListener('change', (event) => {
  const target = event.target;
  if (!target.classList.contains('game-check')) {
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
  try {
    setStatus('Reloading loaded libraries...');

    const refreshedLibraries = await Promise.all(
      libraries.map((library) => {
        if (library.source === 'self') {
          return fetchLibrary();
        }

        return fetchLibrary(library.steamId);
      })
    );

    refreshedLibraries.forEach((library, index) => {
      library.source = libraries[index].source;
    });

    if (isGuest && refreshedLibraries[0]) {
      guestSteamId = refreshedLibraries[0].steamId;
      sessionStorage.setItem(GUEST_STEAM_ID_KEY, guestSteamId);
      setGuestUi(guestSteamId);
    }

    replaceLibraries(refreshedLibraries);
    setStoredComparisonIds(getComparisonIds());
    setStatus(buildStatusMessage());
  } catch (error) {
    console.error('Failed to reload libraries:', error);
    setStatus(`Failed to reload libraries: ${error.message || 'Unknown error'}`);
  }
});

searchInput.addEventListener('input', () => {
  renderList();
});

unknownFilterRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    renderList();
    updateCheckAllState();
    updateSummary();
  });
});

ownershipFilterRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    const ownershipMode = [...ownershipFilterRadios].find((r) => r.checked)?.value || 'all';
    if (ownershipMode === 'shared' && libraries.length > 1) {
      sharedPlayersFieldset.classList.remove('invisible');
      // Auto-select all players if none are selected
      if (sharedPlayerSteamIds.size === 0) {
        libraries.forEach((lib) => sharedPlayerSteamIds.add(lib.steamId));
        updateSharedPlayersFilter();
      }
    } else {
      sharedPlayersFieldset.classList.add('invisible');
      sharedPlayerSteamIds.clear();
    }
    renderList();
    updateCheckAllState();
    updateSummary();
  });
});

sharedPlayersContainer.addEventListener('change', (event) => {
  if (event.target.classList.contains('shared-player-check')) {
    const steamId = event.target.dataset.steamid;
    if (event.target.checked) {
      sharedPlayerSteamIds.add(steamId);
    } else {
      sharedPlayerSteamIds.delete(steamId);
    }
    renderList();
    updateCheckAllState();
    updateSummary();
  }
});

logoutBtn.addEventListener('click', async () => {
  await fetchJson('api/logout', { method: 'POST' });
  sessionStorage.removeItem(COMPARE_STEAM_IDS_KEY);
  window.location.reload();
});

backBtn.addEventListener('click', () => {
  sessionStorage.removeItem(GUEST_STEAM_ID_KEY);
  sessionStorage.removeItem(COMPARE_STEAM_IDS_KEY);
  window.location.reload();
});

loadByIdBtn.addEventListener('click', async () => {
  const steamId = steamIdInput.value.trim();
  if (!steamId) {
    alert('Please enter a Steam ID or vanity URL.');
    return;
  }

  try {
    isGuest = true;
    guestSteamId = steamId;
    setGuestUi(steamId);
    await initializeLibraries();
  } catch (error) {
    console.error('Failed to load library for guest ID:', error);
    const detail = error?.message ? ` (${error.message})` : '';
    alert(`Failed to load library. Check the Steam ID and try again.${detail}`);
    setStatus(`Library load failed${detail}`);
  }
});

comparisonForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const value = comparisonInput.value.trim();
  if (!value) {
    return;
  }

  try {
    setStatus(`Loading comparison library for ${value}...`);
    const library = await fetchLibrary(value);
    library.source = 'comparison';

    if (libraries.some((entry) => entry.steamId === library.steamId)) {
      setStatus(`${library.displayName} is already loaded.`);
      comparisonInput.value = '';
      return;
    }

    replaceLibraries([...libraries, library]);
    setStoredComparisonIds(getComparisonIds());
    comparisonInput.value = '';
    setStatus(buildStatusMessage());
  } catch (error) {
    console.error('Failed to load comparison library:', error);
    setStatus(`Failed to add comparison library: ${error.message || 'Unknown error'}`);
  }
});

loadedUsers.addEventListener('click', (event) => {
  const target = event.target;
  if (!target.classList.contains('user-pill-remove')) {
    return;
  }

  const steamId = target.dataset.steamid;
  if (!steamId) {
    return;
  }

  replaceLibraries(libraries.filter((library) => library.steamId !== steamId));
  setStoredComparisonIds(getComparisonIds());
  setStatus(buildStatusMessage());
});

init().catch((error) => {
  console.error(error);
  setStatus('Failed to initialize app. Check server logs.');
});
