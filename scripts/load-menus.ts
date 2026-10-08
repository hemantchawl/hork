/**
 * Find each restaurant's menu page, fetch it, and have Claude turn it into structured dishes.
 *
 *   npm run load:menus -- --limit 10            # next 10 restaurants without a menu
 *   npm run load:menus -- --id <overture id>    # one restaurant
 *   npm run load:menus -- --category restaurant,casual_eatery --limit 40
 *   npm run load:menus -- --retry --limit 40    # also retry failed / needs_photo restaurants
 *   npm run load:menus -- --dry-run --limit 3   # find + fetch only, no Claude calls
 *   npm run load:menus -- --retry --limit 400 --max-cost 60   # stop when estimated spend passes $60
 *
 * For each restaurant it tries, in order, until a menu with 3+ dishes comes back:
 *   1. menu pages linked from the website (plain HTTP)
 *   2. the same pages rendered in a headless browser (for JavaScript-built menus)
 *   3. a menu URL found by Claude's web search, fetched and rendered the same way
 *
 * Needs ANTHROPIC_API_KEY (or an `ant auth login` profile) unless --dry-run.
 * Rendering needs Playwright's Chromium (`npx playwright install chromium`), or set CHROME_PATH
 * to an installed Chrome/Chromium. Without a browser, step 2 is skipped.
 * Fetched pages are cached in data/cache/ so re-runs don't hit restaurant sites again.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as cheerio from "cheerio";
import { MenuSchema, menuRows, saveMenu, type Menu } from "../lib/menus";
import { DATA_DIR, readAll } from "../lib/store";
import type { MenuItem, Restaurant } from "../lib/types";

const MODEL = "claude-opus-5-5";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 HorkMenuBot/0.2";
const MAX_TEXT_CHARS = 60_000;
const MIN_DISHES = 3;
// USD per million tokens and per search, for the cost summary only.
const PRICE = { input: 4, output: 20, cacheRead: 0.4, search: 0.01 };

const { values: args } = parseArgs({
  options: {
    limit: { type: "string", default: "5" },
    id: { type: "string" },
    area: { type: "string" },
    category: { type: "string" }, // comma-separated Overture categories, e.g. restaurant,casual_eatery
    "dry-run": { type: "boolean", default: false },
    retry: { type: "boolean", default: false },
    "no-render": { type: "boolean", default: false },
    "no-search": { type: "boolean", default: false },
    "max-cost": { type: "string" }, // stop once estimated Claude spend (USD) passes this
  },
});

const DishTypes: string[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, "dish_types.json"), "utf8"));
const usage = { input: 0, output: 0, cacheRead: 0, searches: 0, calls: 0 };

// ---------- fetching ----------

const cacheDir = path.join(DATA_DIR, "cache");
type Page = { url: string; type: string; body: Buffer };

async function cached(key: string, load: () => Promise<Page>): Promise<Page> {
  const file = path.join(cacheDir, createHash("sha1").update(key).digest("hex"));
  try {
    const meta = JSON.parse(await fs.readFile(`${file}.json`, "utf8"));
    return { ...meta, body: await fs.readFile(file) };
  } catch {}
  const out = await load();
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(file, out.body);
  await fs.writeFile(`${file}.json`, JSON.stringify({ url: out.url, type: out.type }));
  return out;
}

function get(url: string) {
  return cached(url, async () => {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/pdf,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return { url: res.url, type: res.headers.get("content-type") ?? "", body: Buffer.from(await res.arrayBuffer()) };
  });
}

// Headless browser, started lazily and shared across restaurants.
type Browser = import("playwright").Browser;
let browser: Promise<Browser | null> | null = null;
function getBrowser() {
  browser ??= (async () => {
    if (args["no-render"]) return null;
    try {
      const { chromium } = await import("playwright");
      return await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    } catch (e) {
      console.warn(`Headless browser unavailable, skipping rendering: ${(e as Error).message.split("\n")[0]}`);
      return null;
    }
  })();
  return browser;
}

/** Load a page in Chromium and return the rendered HTML (cached like plain fetches). */
async function render(url: string): Promise<Page | null> {
  const b = await getBrowser();
  if (!b) return null;
  return cached(`render:${url}`, async () => {
    const ctx = await b.newContext({ userAgent: UA, viewport: { width: 1280, height: 2000 } });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => {});
      // Lazy-loaded menus often appear on scroll.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight && y < 30_000; y += 1500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); }
      });
      await page.waitForTimeout(800);
      return { url: page.url(), type: "text/html; rendered", body: Buffer.from(await page.content()) };
    } finally {
      await ctx.close();
    }
  });
}

function pageText(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, header nav, footer").remove();
  $("br").replaceWith("\n");
  $("p, li, h1, h2, h3, h4, h5, h6, div, tr, section, article, span").each((_, el) => { $(el).append("\n"); });
  return $("body").text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/** Score links that look like a menu; PDFs and same-site links win. */
function menuLinks(html: string, base: string) {
  const $ = cheerio.load(html);
  const host = new URL(base).hostname.replace(/^www\./, "");
  const seen = new Map<string, number>();
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href")!;
    const text = $(a).text().trim().toLowerCase();
    let url: URL;
    try { url = new URL(href, base); } catch { return; }
    if (!/^https?:$/.test(url.protocol)) return;
    if (/instagram|facebook|twitter|x\.com|tiktok|yelp|google|opentable|resy|tock/.test(url.hostname)) return;
    if (/\.(jpe?g|png|gif|webp|svg|mp4)($|\?)/i.test(url.pathname)) return;
    const hay = `${text} ${url.pathname.toLowerCase()}`;
    // "menu" anywhere counts; other words only as short nav labels, so blog posts about "food" don't match.
    let score: number;
    if (/menu/.test(hay)) score = 10;
    else if (text.length <= 25 && /^(order|order online|food|eat|dinner|lunch|brunch|breakfast|drinks)\b/.test(text)) score = /order/.test(text) ? 4 : 3;
    else return;
    if (/\.pdf($|\?)/i.test(url.pathname)) score += 3;
    if (url.hostname.replace(/^www\./, "") === host) score += 2;
    if (/doordash|ubereats|grubhub|postmates|seamless/.test(url.hostname)) score -= 6;
    url.hash = "";
    seen.set(url.toString(), Math.max(seen.get(url.toString()) ?? -99, score));
  });
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

type Source = { url: string; kind: "html"; text: string; how: string } | { url: string; kind: "pdf"; data: string; how: string };

function toSource(p: Page, how: string): Source | null {
  if (p.type.includes("pdf") || p.body.subarray(0, 5).toString() === "%PDF-") {
    return { url: p.url, kind: "pdf", data: p.body.toString("base64"), how };
  }
  const text = pageText(p.body.toString("utf8"));
  return text.length > 300 ? { url: p.url, kind: "html", text, how } : null;
}

/** Candidate menu sources for a URL, cheapest first: plain fetch, then rendered. Yields lazily. */
async function* sourcesFor(start: string): AsyncGenerator<Source> {
  const tried = new Set<string>();
  let home: Page | null = null;
  try { home = await get(start); } catch (e) { console.log(`  fetch failed: ${(e as Error).message}`); }

  // 1. Plain HTML: menu links on the homepage, then the homepage itself.
  const plainLinks = home && !home.type.includes("pdf") ? menuLinks(home.body.toString("utf8"), home.url).slice(0, 3) : [];
  if (home) { const s = toSource(home, "plain"); if (s?.kind === "pdf") { tried.add(s.url); yield s; } }
  for (const url of plainLinks) {
    if (tried.has(url)) continue;
    tried.add(url);
    try { const s = toSource(await get(url), "plain"); if (s) yield s; } catch (e) { console.log(`  skip ${url}: ${(e as Error).message}`); }
  }

  // 2. Rendered: the homepage (to discover links built by JavaScript), then the best menu links.
  const rHome = await render(start).catch(() => null);
  if (!rHome) return;
  const links = [...new Set([...plainLinks, ...menuLinks(rHome.body.toString("utf8"), rHome.url)])].slice(0, 3);
  for (const url of links) {
    if (url.toLowerCase().endsWith(".pdf")) continue; // PDFs were tried above via plain fetch
    try { const p = await render(url); const s = p && toSource(p, "rendered"); if (s) yield s; } catch (e) { console.log(`  render failed ${url}: ${(e as Error).message.split("\n")[0]}`); }
  }
  const s = toSource(rHome, "rendered");
  if (s && !links.includes(rHome.url)) yield s;
}

// ---------- Claude ----------

function spend() {
  return (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheRead * PRICE.cacheRead) / 1e6 + usage.searches * PRICE.search;
}

function track(u: Anthropic.Beta.BetaUsage) {
  usage.calls++;
  usage.input += u.input_tokens + (u.cache_creation_input_tokens ?? 0);
  usage.output += u.output_tokens;
  usage.cacheRead += u.cache_read_input_tokens ?? 0;
  usage.searches += u.server_tool_use?.web_search_requests ?? 0;
}

const SYSTEM = `You turn restaurant web pages and PDFs into structured menus for a dish-rating app.
Rules:
- Only include dishes and drinks that are actually on the menu. Ignore hours, addresses, reviews, ordering instructions and navigation text.
- Keep the restaurant's own section names and dish names (fix only obvious casing problems).
- price is a number in dollars; use null when no single price is shown.
- dish_type must be exactly one of the allowed values, or null if none fits:
${DishTypes.join(", ")}
- If the page shows only part of the menu, extract what is there.
- If the content is not a menu at all, return is_menu=false and no sections.`;

async function extract(client: Anthropic, r: Restaurant, src: Source): Promise<Menu> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = src.kind === "pdf"
    ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: src.data } }]
    : [{ type: "text", text: `<page url="${src.url}">\n${src.text.slice(0, MAX_TEXT_CHARS)}\n</page>` }];
  content.push({ type: "text", text: `Extract the menu for ${r.name} (${r.address ?? "Los Angeles"}).` });

  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(MenuSchema) },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });
  track(res.usage);
  if (res.stop_reason === "refusal") throw new Error("Claude declined this page");
  if (res.stop_reason === "max_tokens") throw new Error("Menu too long for one response");
  if (!res.parsed_output) throw new Error("No structured output returned");
  return res.parsed_output;
}

/** Ask Claude to find the restaurant's own menu page with web search. Returns a URL or null. */
async function searchMenuUrl(client: Anthropic, r: Restaurant): Promise<string | null> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{
    role: "user",
    content: `Find the current online menu for this restaurant:
Name: ${r.name}
Address: ${r.address ?? ""}, ${r.locality ?? "Los Angeles"}, CA
Website: ${r.website ?? "unknown"}

Prefer, in order: a menu page or PDF on the restaurant's own website; its official online-ordering page (Toast, Square, ChowNow, Clover, Popmenu, BentoBox); otherwise none.
Do not return Yelp, Google, DoorDash, Uber Eats, Grubhub, Instagram or review sites.
Reply with only the URL on one line, or NONE.`,
  }];
  for (let turn = 0; turn < 3; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      tools: [{
        type: "web_search_20250305", name: "web_search", max_uses: 3,
        blocked_domains: ["yelp.com", "doordash.com", "ubereats.com", "grubhub.com", "instagram.com", "facebook.com", "tripadvisor.com"],
        user_location: { type: "approximate", city: "Los Angeles", region: "California", country: "US", timezone: "America/Los_Angeles" },
      }],
      messages,
    });
    track(res.usage);
    if (res.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: res.content }); continue; }
    if (res.stop_reason === "refusal") return null;
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const url = text.match(/https?:\/\/[^\s<>()"']+/)?.[0]?.replace(/[.,;]+$/, "");
    return url ?? null;
  }
  return null;
}

// ---------- main ----------

function startUrl(u: string) {
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

async function loadOne(client: Anthropic | null, r: Restaurant): Promise<{ status: Restaurant["menu_status"]; url: string | null; rows: MenuItem[] }> {
  const attempts: string[] = [];
  const starts = r.website ? [startUrl(r.menu_url ?? r.website)] : [];
  const seenText = new Set<string>();
  let searched = false;
  let claudeCalls = 0;

  for (let i = 0; i < starts.length || (!searched && client && !args["no-search"]); i++) {
    if (i >= starts.length) {
      searched = true;
      const found = await searchMenuUrl(client!, r);
      console.log(`  web search → ${found ?? "nothing"}`);
      if (!found || starts.includes(found)) break;
      starts.push(found);
    }
    for await (const src of sourcesFor(starts[i])) {
      const fingerprint = createHash("sha1").update(src.kind === "pdf" ? src.data : src.text).digest("hex");
      if (seenText.has(fingerprint)) continue; // same content as a page already sent to Claude
      seenText.add(fingerprint);
      attempts.push(`${src.how}:${src.url}`);
      console.log(`  try ${src.how} ${src.kind} ${src.url}${src.kind === "html" ? ` (${src.text.length} chars)` : ""}`);
      if (!client) continue;
      if (++claudeCalls > 4) return { status: "needs_photo", url: null, rows: [] };
      try {
        const menu = await extract(client, r, src);
        const rows = menuRows(r.id, menu, { url: src.url, kind: src.kind === "pdf" ? "pdf" : "web" }, DishTypes);
        console.log(`    → ${rows.length} dishes in ${menu.sections.length} sections`);
        if (rows.length >= MIN_DISHES) return { status: "loaded", url: src.url, rows };
      } catch (e) {
        console.log(`    → failed: ${(e as Error).message}`);
      }
    }
  }
  return { status: attempts.length ? "needs_photo" : "failed", url: null, rows: [] };
}

async function main() {
  const all = await readAll("restaurants");
  const cats = args.category?.split(",").map((c) => c.trim()).filter(Boolean);
  const retryable = new Set<Restaurant["menu_status"]>(args.retry ? ["missing", "failed", "needs_photo"] : ["missing"]);
  const queue = all.filter((r) =>
    args.id ? r.id === args.id
      : (!args.area || r.area === args.area) && (!cats || cats.includes(r.category ?? "")) && retryable.has(r.menu_status),
  ).slice(0, args.id ? 1 : Number(args.limit));
  if (!queue.length) return console.log("Nothing to do.");

  const client = args["dry-run"] ? null : new Anthropic();
  let loaded = 0;
  for (const [n, r] of queue.entries()) {
    console.log(`\n[${n + 1}/${queue.length}] ${r.name} — ${r.website ?? "no website"}`);
    let result: Awaited<ReturnType<typeof loadOne>>;
    try {
      result = await loadOne(client, r);
    } catch (e) {
      console.log(`  failed: ${(e as Error).message}`);
      result = { status: "failed", url: null, rows: [] };
    }
    if (!client) continue;
    console.log(`  ${result.status}${result.rows.length ? ` (${result.rows.length} dishes)` : ""}`);
    await saveMenu(r.id, result.rows, result.url, result.status);
    if (result.status === "loaded") loaded++;
    if (args["max-cost"] && spend() >= Number(args["max-cost"])) {
      console.log(`\nStopping: estimated spend $${spend().toFixed(2)} reached --max-cost ${args["max-cost"]}.`);
      break;
    }
  }
  await (await browser)?.close();
  if (!client) return;
  const cost = spend();
  console.log(`\nLoaded ${loaded} of ${queue.length} menus. Claude: ${usage.calls} calls, ${usage.searches} searches, ` +
    `${(usage.input / 1000).toFixed(0)}k in / ${(usage.output / 1000).toFixed(0)}k out tokens, about $${cost.toFixed(2)}.`);
}

await main();
