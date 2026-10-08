# Hork

**It's not about where to eat. It's about what to eat.**
A scrappy prototype of a dish-first food app: open it at a restaurant, see what your friends loved and what to skip,
log what you ate in ten seconds.

This is the 4-week prototype from the *Hork — Scrappy Prototype Design* doc: real restaurants, real menus,
real ratings from testers, and JSON files instead of a database.

## What's in it

| Screen | Path | What it does |
| --- | --- | --- |
| Here | `/` | Uses your location to list the nearest restaurants; search by name |
| Menu | `/r/[id]` | The real menu by section, with love / fine / skip counts, friends' verdicts, *Top pick* and *Skip it* badges, and a "What's good here" summary |
| Log | `/log/[itemId]` | Love / Fine / Skip, optional photo and note |
| Best near me | `/best` | Pick a dish type (burger, pasta, taco…) and get every version nearby, ranked |
| Stream | `/stream` | What friends (or everyone) are eating |
| Me / profiles | `/me`, `/u/[handle]`, `/people` | Your dish history; "eat like Beth"; follow people |
| Admin | `/admin` | Restaurants missing menus; paste a menu by hand |

Sign-in is **Sign in with Google**. For local development and automated tests there's also a handle-only
sign-in (no password), which is on only when Google isn't configured or `HORK_ALLOW_HANDLE_LOGIN=1`.
Sessions are a signed, HTTP-only cookie (`lib/session.ts`).

### Set up Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create credentials →
   OAuth client ID → Web application**. (First time: configure the OAuth consent screen as *External*, add the
   `openid`, `email` and `profile` scopes, and add your testers as test users while the app is in *Testing*.)
2. Under **Authorized redirect URIs** add `<your app URL>/api/auth/google/callback`, e.g.
   `http://localhost:3000/api/auth/google/callback` for local dev and `https://<your domain>/api/auth/google/callback`
   for the deployed app.
3. Put the client ID and secret in `.env` (see `.env.example`) with `APP_URL` and a `SESSION_SECRET`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
4. Restart the app; **Me** now shows *Sign in with Google*. New users get a handle from their email, which they
   can change on **Me**.

In production (`npm start`) cookies are `Secure`, so serve the app over HTTPS.

**Ranking v0:** `score = (loves + 0.5 × fines + 1) / (ratings + 2)`. *Top pick* needs 3+ ratings and a score of 0.7;
*Skip it* needs 3+ ratings with most of them Skip. Only each person's latest verdict on a dish counts. See `lib/score.ts`.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # unit tests (scoring)
npm run typecheck
```

On a phone on the same Wi-Fi, open `http://<your-laptop-ip>:3000`. Browsers only share location over HTTPS or
localhost, so for real phone testing deploy it (below) or use a tunnel such as `cloudflared tunnel --url http://localhost:3000`.

## Data

Everything lives in `data/` as JSON:

| File | Contents |
| --- | --- |
| `areas.json` | Launch neighborhoods (bounding boxes). Currently Silver Lake, LA |
| `restaurants.json` | 348 real food places from Overture Maps (includes Foursquare Open Source Places) |
| `menu_items.json` | Structured menus; every item keeps its `source_url` |
| `dish_types.json` | The fixed list used for "Best ___ near me" |
| `users.json`, `logs.json`, `follows.json` | Created by testers |
| `uploads/` | Dish photos (git-ignored) |

Writes go through `lib/store.ts`: one lock per file, write to a temp file, then rename. Good for one server
process and a few dozen testers; move to Postgres (see the MVP technical design) before going further.
Set `HORK_DATA_DIR` to point the app at a different data folder.

### Load restaurants (real, free)

```bash
pip install pyarrow
npm run load:places -- --area silver-lake
```

Reads only the Overture Parquet row groups that overlap the area's bounding box (a few MB, not the 11 GB release).
Add a neighborhood by adding a bounding box to `data/areas.json`. Re-running keeps menu work already done.

### Load menus

```bash
cp .env.example .env     # add ANTHROPIC_API_KEY
npm run load:menus -- --limit 10          # next 10 restaurants without a menu
npm run load:menus -- --id <restaurant id>
npm run load:menus -- --dry-run --limit 20   # find + fetch menu pages only, no Claude calls
```

For each restaurant the script tries, in order, until Claude (`claude-opus-5-5`, structured outputs) returns
3 or more dishes:

1. menu pages and PDFs linked from the website, fetched as plain HTML;
2. the same pages rendered in headless Chromium, for menus built with JavaScript (BentoBox, Square, Toast…);
3. a menu URL found with Claude's web search, fetched and rendered the same way.

Pages are cached in `data/cache/`. Re-running a restaurant keeps dish ids that are still on the menu, so existing
ratings stay attached. Restaurants where nothing works are marked `needs_photo`. The run prints Claude usage and
an estimated cost; `--max-cost 20` stops once that estimate passes $20.

Rendering needs a Chromium: `npx playwright install chromium`, or set `CHROME_PATH` to an installed Chrome.
Use `--no-render` or `--no-search` to skip those steps.

Other ways in:
- `npx tsx scripts/import-menu.ts <restaurant id> <menu.json> <source url> [web|pdf|photo]` — import a menu JSON
  in the same shape the loader uses.
- `/admin` → *Add menu* — paste `Section | Dish | Price | dish_type | Description` lines.
- `npx tsx scripts/menu-text.ts <url>` — print the cleaned text the loader would send to Claude.

The six menus in the repo today (Barbrix, Donna's, Botanica, Bowery Bungalow, 33 Taps, Wong's Wok) were taken
from those restaurants' websites in October 2026. There are no seeded ratings — every rating comes from a tester.

## Deploying

JSON files need a persistent disk, so use a host with a volume (Fly.io, Render, Railway, or a small VM) and set
`HORK_DATA_DIR` to the mounted volume. Serverless hosts such as Vercel won't keep writes. Set the Google and
`SESSION_SECRET` variables from `.env.example`, and `HORK_ADMINS` (comma-separated handles or emails) to limit
`/admin`; if unset, any signed-in tester is an admin.

## Testing the full loop

`tests/e2e.mjs` (run the server with `HORK_ALLOW_HANDLE_LOGIN=1`) signs in three testers, logs dishes, follows, and checks the menu badges, stream, profile,
"Best near me" and off-menu dishes against a running server on a copy of the data (instructions at the top of the file).
