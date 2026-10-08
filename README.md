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

Sign-in is **Sign in with Google** via Auth.js (same Google OAuth setup as pioneer-luxury). For local
development and automated tests there's also a handle-only sign-in (no password), which is on only when
Google isn't configured or `HORK_ALLOW_HANDLE_LOGIN=1`. Sessions are Auth.js JWTs (`lib/auth.ts`).

### Set up Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create credentials →
   OAuth client ID → Web application**. (First time: configure the OAuth consent screen as *External*, add the
   `openid`, `email` and `profile` scopes, and add your testers as test users while the app is in *Testing*.)
2. Under **Authorized redirect URIs** add `<your app URL>/api/auth/callback/google`, e.g.
   `http://localhost:3001/api/auth/callback/google` for local dev (use the port Next actually prints) and
   `https://<your domain>/api/auth/callback/google` for the deployed app.
3. Put the client ID and secret in `.env` as `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (or `GOOGLE_CLIENT_ID` /
   `GOOGLE_CLIENT_SECRET`) with `APP_URL` and an `AUTH_SECRET` (or `SESSION_SECRET`):
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

## Deploying to Vercel

The app runs on Vercel with its data in **Vercel Blob**:

- `lib/store.ts` switches to Blob automatically when `BLOB_READ_WRITE_TOKEN` is set (or `HORK_STORAGE=blob`).
  Each collection is a private blob at `hork/<name>.json`, created from the bundled `data/` copy the first time
  it's read. Writes are ETag-conditional with retries, so simultaneous requests can't overwrite each other
  (`lib/store-blob.test.ts`). Dish photos go to `hork/uploads/`.
- Locally nothing changes: without the token, the app reads and writes `data/*.json`.

Setup:

1. Import the GitHub repo in Vercel (framework: Next.js).
2. **Storage → Create → Blob**, connect it to the project. This adds `BLOB_READ_WRITE_TOKEN`.
3. Environment variables: `AUTH_SECRET` (32+ random characters), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
   and optionally `HORK_ADMINS`.
4. In Google Cloud, add `https://<your-vercel-domain>/api/auth/callback/google` as an authorized redirect URI.

Moving data between your checkout and Blob (`BLOB_READ_WRITE_TOKEN` from the Blob store's `.env.local` tab):

```bash
npm run blob -- status                          # row counts in Blob vs data/
npm run blob -- pull                            # back up Blob to data/backups/<time>/ (git-ignored)
npm run blob -- push restaurants menu_items     # after re-running the loaders; keeps dishes testers added
```

Tester data (`users`, `logs`, `follows`) lives only in Blob once deployed; use `pull` for backups.

## Testing the full loop

`tests/e2e.mjs` (run the server with `HORK_ALLOW_HANDLE_LOGIN=1`) signs in three testers, logs dishes, follows, and checks the menu badges, stream, profile,
"Best near me" and off-menu dishes against a running server on a copy of the data (instructions at the top of the file).
