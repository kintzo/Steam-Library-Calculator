const path = require('path');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const dotenv = require('dotenv');
const {
  getOwnedGames,
  enrichGamesWithEstimatedSize
} = require('./src/services/steamService');

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

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
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

app.use(express.static(path.join(__dirname, 'public')));

app.get('/auth/steam', passport.authenticate('steam', { failureRedirect: '/' }));

app.get(
  '/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/');
  }
);

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

    if (req.query.steamId) {
      // Guest mode
      steamId = await resolveSteamId(req.query.steamId, STEAM_API_KEY);
    } else {
      // Authenticated mode
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      steamId = req.user.id || req.user._json?.steamid;
    }

    const games = await getOwnedGames({ steamId, apiKey: STEAM_API_KEY });
    const enriched = await enrichGamesWithEstimatedSize(games);

    return res.json({
      generatedAt: new Date().toISOString(),
      totalGames: enriched.length,
      games: enriched
    });
  } catch (error) {
    console.error('Failed to load library:', error);
    return res.status(500).json({ error: 'Failed to load Steam library' });
  }
});

app.listen(PORT, () => {
  console.log(`Steam Library Calculator running at ${BASE_URL}`);
});
