const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const dotenv = require('dotenv');
const fs = require('fs').promises;
const {
  getOwnedGames,
  enrichGamesWithEstimatedSize
} = require('./src/services/steamService');

async function getPlayerSummary(steamId, apiKey) {
  const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('steamids', steamId);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to load Steam profile summary');
  }

  const data = await response.json();
  const player = data?.response?.players?.[0];

  return {
    steamId,
    displayName: player?.personaname || `Steam User ${steamId}`,
    avatar: player?.avatarfull || player?.avatarmedium || player?.avatar || null
  };
}

async function loadLibraryPayload({ steamId, apiKey }) {
  const [games, owner] = await Promise.all([
    getOwnedGames({ steamId, apiKey }),
    getPlayerSummary(steamId, apiKey).catch(() => ({
      steamId,
      displayName: `Steam User ${steamId}`,
      avatar: null
    }))
  ]);
  const enriched = await enrichGamesWithEstimatedSize(games);

  return {
    owner,
    games: enriched
  };
}

async function resolveSteamId(input, apiKey) {
  // If it's numeric, assume it's Steam ID
  if (/^\d+$/.test(input)) {
    return input;
  }

  // Otherwise, resolve vanity URL
  const url = new URL('https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('vanityurl', input);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to resolve vanity URL');
  }

  const data = await response.json();
  const steamId = data?.response?.steamid;
  if (!steamId) {
    throw new Error('Invalid Steam ID or vanity URL');
  }

  return steamId;
}

async function loadCustomSizes() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'customSizes.json'), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

async function saveCustomSizes(sizes) {
  await fs.writeFile(path.join(__dirname, 'customSizes.json'), JSON.stringify(sizes, null, 2));
}

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const APP_PATH = process.env.APP_PATH || '/';
const SESSION_SECRET = process.env.SESSION_SECRET;
const STEAM_API_KEY = process.env.STEAM_API_KEY;

if (!SESSION_SECRET) {
  throw new Error('Missing required env var: SESSION_SECRET');
}

if (!STEAM_API_KEY) {
  throw new Error('Missing required env var: STEAM_API_KEY');
}

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

passport.use(
  new SteamStrategy(
    {
      returnURL: `${BASE_URL}/auth/steam/return`,
      realm: BASE_URL,
      apiKey: STEAM_API_KEY
    },
    (identifier, profile, done) => {
      profile.identifier = identifier;
      return done(null, profile);
    }
  )
);

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }

  return res.status(401).json({ error: 'Not authenticated' });
}

app.use("/", express.static(path.join(__dirname, 'public')));

// Auth routes
app.get('/auth/steam', passport.authenticate('steam', { failureRedirect: APP_PATH }));

app.get(
  '/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: APP_PATH }),
  (req, res) => {
    res.redirect(APP_PATH);
  }
);

// API routes
app.post('/api/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }

    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    return res.json({ authenticated: false });
  }

  const steamId = req.user.id || req.user._json?.steamid;

  return res.json({
    authenticated: true,
    user: {
      steamId,
      displayName: req.user.displayName || 'Steam User',
      avatar: req.user.photos?.[2]?.value || req.user.photos?.[0]?.value || null
    }
  });
});

app.get('/api/library', async (req, res) => {
  try {
    let steamId;
    let requestedAs = null;
    let owner;

    if (req.query.steamId) {
      requestedAs = String(req.query.steamId);
      steamId = await resolveSteamId(req.query.steamId, STEAM_API_KEY);
    } else {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      steamId = req.user.id || req.user._json?.steamid;
      owner = {
        steamId,
        displayName: req.user.displayName || 'Steam User',
        avatar: req.user.photos?.[2]?.value || req.user.photos?.[0]?.value || null
      };
    }

    const payload = await loadLibraryPayload({ steamId, apiKey: STEAM_API_KEY });

    if (!owner) {
      owner = payload.owner;
    }

    return res.json({
      generatedAt: new Date().toISOString(),
      requestedAs,
      steamId,
      owner,
      totalGames: payload.games.length,
      games: payload.games
    });
  } catch (error) {
    console.error('Failed to load library:', error);
    return res.status(500).json({ error: 'Failed to load Steam library' });
  }
});

app.get('/api/customSizes', async (req, res) => {
  try {
    const sizes = await loadCustomSizes();
    res.json(sizes);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load custom sizes' });
  }
});

app.post('/api/customSizes', express.json(), async (req, res) => {
  try {
    const { appid, sizeMb } = req.body;
    if (!appid || typeof sizeMb !== 'number') {
      return res.status(400).json({ error: 'Invalid data' });
    }
    const sizes = await loadCustomSizes();
    sizes[appid] = sizeMb;
    await saveCustomSizes(sizes);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save custom size' });
  }
});

app.listen(PORT, () => {
  console.log(`Steam Library Calculator running at ${BASE_URL}`);
});
