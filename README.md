# Steam Library Calculator

A Node.js web app that authenticates with Steam, loads your game library, and estimates total required disk size based on Steam Store requirements.

## Features

- Steam sign-in using OpenID (`passport-steam`)
- Loads your owned games from Steam Web API
- Displays your full library in a checkbox list
- `Check all visible` and `clear selection`
- Live sum of selected game disk requirements
- Search/filter over the game list
- Hide games with unknown size
- Community-contributed size data for unknown games

## Important Accuracy Note

Steam Web API does not provide an exact installed size per game. This app estimates size from each game's Steam Store `pc_requirements` text (minimum/recommended storage). Some games may show `Unknown` or values that differ from real installed size.

For games with unknown size, users can contribute community size data by clicking the "Unknown" text and entering the size in GB. This data is shared across all users.

## Library count behavior

- The app uses `IPlayerService/GetOwnedGames` from Steam Web API.
- It currently includes owned games and free-to-play games you have played (with `include_played_free_games=true`).
- It does not include games from family shared libraries, and it may not include unplayed free-to-play titles.
- So your Steam client count (e.g., "My games" + "Steam family") may be higher than the app's count.

## Prerequisites

- Node.js 18+
- Steam Web API key: https://steamcommunity.com/dev/apikey

## Setup (Local Node)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create `.env` from `.env.example` and set values:
   - `SESSION_SECRET`: any long random string
   - `STEAM_API_KEY`: your Steam API key
   - `BASE_URL`: `http://localhost:3000` for local development
3. Start app:
   ```bash
   npm run dev
   ```
4. Open `http://localhost:3000`

## Deploy with Podman

1. Ensure `.env` exists and has valid values for:
   - `PORT=3000`
   - `BASE_URL=http://localhost:3000`
   - `SESSION_SECRET=...`
   - `STEAM_API_KEY=...`

2. Build image:
   ```bash
   podman build -t steam-library-calculator:latest -f Containerfile .
   ```

3. Run container:
   ```bash
   podman run -d --name steam-library-calculator --env-file .env -p 3000:3000 steam-library-calculator:latest
   ```

4. Open `http://localhost:3000`

5. Stop/remove when needed:
   ```bash
   podman stop steam-library-calculator
   podman rm steam-library-calculator
   ```

### Deploy with Podman Compose

1. Start:
   ```bash
   podman compose -f podman-compose.yml up -d --build
   ```

2. View logs:
   ```bash
   podman compose -f podman-compose.yml logs -f
   ```

3. Stop:
   ```bash
   podman compose -f podman-compose.yml down
   ```

## Notes

- For production behind HTTPS, set secure cookies and trust proxy settings.
- Library loading can take time for large accounts because each app may need a store lookup.
- Steam OpenID callback relies on `BASE_URL`; make sure it matches the URL you actually use in browser.
