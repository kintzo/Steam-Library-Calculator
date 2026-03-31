const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const CACHE_FILE_PATH = path.join(__dirname, '../../appdetailsCache.json');

function loadAppdetailsCache() {
  try {
    if (!fs.existsSync(CACHE_FILE_PATH)) {
      return {};
    }

    const content = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(content || '{}');

    if (typeof parsed !== 'object' || parsed === null) {
      console.warn('Invalid appdetails cache format, resetting.');
      return {};
    }

    return parsed;
  } catch (error) {
    console.warn('Unable to load appdetails cache:', error);
    return {};
  }
}

async function saveAppdetailsCache(map) {
  try {
    const obj = {};
    for (const [key, value] of map.entries()) {
      obj[key] = value;
    }
    await fsPromises.writeFile(CACHE_FILE_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (error) {
    console.warn('Unable to write appdetails cache:', error);
  }
}

const SIZE_CACHE = new Map(Object.entries(loadAppdetailsCache()).map(([key, value]) => [Number(key), value]));

async function getOwnedGames({ steamId, apiKey }) {
  const url = new URL('https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamid', steamId);
  url.searchParams.set('include_appinfo', 'true');
  url.searchParams.set('include_played_free_games', 'true');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Steam Library Calculator/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Steam API error: ${response.status}`);
  }

  const data = await response.json();
  const games = data?.response?.games || [];

  return games
    .map((game) => ({
      appid: game.appid,
      name: game.name || `App ${game.appid}`
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function enrichGamesWithEstimatedSize(games, concurrency = 8) {
  return runWithConcurrency(games, concurrency, async (game) => {
    const cached = SIZE_CACHE.get(game.appid);

    if (cached && cached.sizeMb !== null) {
      return {
        ...game,
        sizeMb: cached.sizeMb,
        sizeLabel: formatSizeMb(cached.sizeMb),
        sizeSource: cached.sizeSource,
        thumbnailUrl: cached.thumbnailUrl
      };
    }

    const sizeInfo = await fetchEstimatedSize(game.appid);
    if (sizeInfo.sizeMb !== null) {
      SIZE_CACHE.set(game.appid, sizeInfo);
      await saveAppdetailsCache(SIZE_CACHE);
    }

    return {
      ...game,
      sizeMb: sizeInfo.sizeMb,
      sizeLabel: formatSizeMb(sizeInfo.sizeMb),
      sizeSource: sizeInfo.sizeSource,
      thumbnailUrl: sizeInfo.thumbnailUrl
    };
  });
}

async function fetchEstimatedSize(appid) {
  const url = new URL('https://store.steampowered.com/api/appdetails');
  url.searchParams.set('appids', String(appid));
  url.searchParams.set('l', 'english');

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Steam Library Calculator/1.0'
      }
    });

    if (!response.ok) {
      return { sizeMb: null, sizeSource: 'unavailable', thumbnailUrl: null };
    }

    const payload = await response.json();
    const entry = payload?.[appid];

    if (!entry || !entry.success || !entry.data) {
      return { sizeMb: null, sizeSource: 'unavailable', thumbnailUrl: null };
    }

    const requirements = entry.data.pc_requirements || {};
    const sizeMb = extractStorageMb(requirements.minimum, requirements.recommended);
    const thumbnailUrl = entry.data.small_capsule_image || entry.data.header_image || null;

    if (sizeMb === null) {
      return { sizeMb: null, sizeSource: 'not_listed', thumbnailUrl };
    }

    return { sizeMb, sizeSource: 'steam_store_requirements', thumbnailUrl };
  } catch {
    return { sizeMb: null, sizeSource: 'unavailable', thumbnailUrl: null };
  }
}

function extractStorageMb(minimumHtml, recommendedHtml) {
  const minText = htmlToText(minimumHtml || '');
  const recText = htmlToText(recommendedHtml || '');
  const combined = `${minText}\n${recText}`;

  const storageLineMatch = combined.match(
    /(storage|hard drive|hard disk|disk space|hd space|available space)\s*:([^\n]+)/i
  );

  if (storageLineMatch && storageLineMatch[2]) {
    const parsed = parseSizeToMb(storageLineMatch[2]);

    if (parsed !== null) {
      return parsed;
    }
  }

  return parseSizeToMb(combined);
}

function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSizeToMb(text) {
  const matches = [...String(text).matchAll(/(\d+(?:[.,]\d+)?)\s*(tb|gb|mb|kb)\b/gi)];

  if (matches.length === 0) {
    return null;
  }

  let maxMb = 0;

  for (const match of matches) {
    const rawValue = match[1].replace(',', '.');
    const value = Number(rawValue);
    const unit = match[2].toLowerCase();

    if (!Number.isFinite(value)) {
      continue;
    }

    let inMb = value;

    if (unit === 'kb') {
      inMb = value / 1024;
    } else if (unit === 'gb') {
      inMb = value * 1024;
    } else if (unit === 'tb') {
      inMb = value * 1024 * 1024;
    }

    if (inMb > maxMb) {
      maxMb = inMb;
    }
  }

  return maxMb > 0 ? Math.round(maxMb) : null;
}

function formatSizeMb(sizeMb) {
  if (sizeMb === null) {
    return 'Unknown';
  }

  if (sizeMb >= 1024 * 1024) {
    return `${(sizeMb / (1024 * 1024)).toFixed(2)} TB`;
  }

  if (sizeMb >= 1024) {
    return `${(sizeMb / 1024).toFixed(2)} GB`;
  }

  return `${sizeMb.toFixed(0)} MB`;
}

async function runWithConcurrency(items, concurrency, handler) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await handler(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}

module.exports = {
  getOwnedGames,
  enrichGamesWithEstimatedSize,
  formatSizeMb
};
