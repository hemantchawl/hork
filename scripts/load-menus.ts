/**
 * Find each restaurant's menu page, fetch it, and have Claude turn it into structured dishes.
 *
 *   npm run load:menus -- --limit 10            # next 10 restaurants without a menu
 *   npm run load:menus -- --id <overture id>    # one restaurant
 *   npm run load:menus -- --dry-run --limit 3   # find + fetch only, no Claude calls
 *   npm run load:menus -- --category restaurant,casual_eatery --limit 40
 *
 * Needs ANTHROPIC_API_KEY (or an `ant auth login` profile) unless --dry-run.
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
const UA = "Mozilla/5.0 (compatible; HorkMenuBot/0.1; +prototype)";
const MAX_TEXT_CHARS = 60_000;

const { values: args } = parseArgs({
  options: {
    limit: { type: "string", default: "5" },
    id: { type: "string" },
    area: { type: "string" },
    category: { type: "string" }, // comma-separated Overture categories, e.g. restaurant,casual_eatery
    "dry-run": { type: "boolean", default: false },
    retry: { type: "boolean", default: false }, // also retry restaurants marked failed
  },
});

const DishTypes: string[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, "dish_types.json"), "utf8"));



// ---------- fetching ----------

const cacheDir = path.join(DATA_DIR, "cache");

async function get(url: string): Promise<{ url: string; type: string; body: Buffer }> {
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(cacheDir, key);
  try {
    const meta = JSON.parse(await fs.readFile(`${file}.json`, "utf8"));
    return { ...meta, body: await fs.readFile(file) };
  } catch {}
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/pdf,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const out = { url: res.url, type: res.headers.get("content-type") ?? "", body: Buffer.from(await res.arrayBuffer()) };
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(file, out.body);
  await fs.writeFile(`${file}.json`, JSON.stringify({ url: out.url, type: out.type }));
  return out;
}

function pageText(html: string) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, header nav, footer").remove();
  $("br").replaceWith("\n");
  $("p, li, h1, h2, h3, h4, h5, h6, div, tr, section, article").each((_, el) => { $(el).append("\n"); });
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
    if (!/menu|food|eat|dinner|lunch|brunch|drinks/.test(hay)) return;
    let score = /menu/.test(hay) ? 10 : 2;
    if (/\.pdf($|\?)/i.test(url.pathname)) score += 3;
    if (url.hostname.replace(/^www\./, "") === host) score += 2;
    if (/toasttab|square\.site|popmenu|order|doordash|ubereats|grubhub|postmates/.test(url.hostname + url.pathname)) score -= 4;
    url.hash = "";
    seen.set(url.toString(), Math.max(seen.get(url.toString()) ?? -99, score));
  });
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([u]) => u);
}

type Source = { url: string; kind: "html"; text: string } | { url: string; kind: "pdf"; data: string };

async function findMenu(r: Restaurant): Promise<Source | null> {
  let start = r.menu_url ?? r.website;
  if (!start) return null;
  if (!/^https?:\/\//i.test(start)) start = `https://${start}`;
  const home = await get(start);
  const candidates: string[] = [];
  if (home.type.includes("pdf")) return { url: home.url, kind: "pdf", data: home.body.toString("base64") };
  const homeHtml = home.body.toString("utf8");
  candidates.push(...menuLinks(homeHtml, home.url).slice(0, 3));

  for (const url of candidates) {
    try {
      const page = await get(url);
      if (page.type.includes("pdf")) return { url: page.url, kind: "pdf", data: page.body.toString("base64") };
      const text = pageText(page.body.toString("utf8"));
      if (text.length > 400 && /\$?\d+(\.\d\d)?/.test(text)) return { url: page.url, kind: "html", text };
    } catch (e) {
      console.warn(`  skip ${url}: ${(e as Error).message}`);
    }
  }
  const text = pageText(homeHtml);
  return text.length > 400 ? { url: home.url, kind: "html", text } : null;
}

// ---------- extraction ----------

const SYSTEM = `You turn restaurant web pages and PDFs into structured menus for a dish-rating app.
Rules:
- Only include dishes and drinks that are actually on the menu. Ignore hours, addresses, reviews, ordering instructions and navigation text.
- Keep the restaurant's own section names and dish names (fix only obvious casing problems).
- price is a number in dollars; use null when no single price is shown.
- dish_type must be exactly one of the allowed values, or null if none fits:
${DishTypes.join(", ")}
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
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined this page");
  if (res.stop_reason === "max_tokens") throw new Error("Menu too long for one response");
  if (!res.parsed_output) throw new Error("No structured output returned");
  return res.parsed_output;
}

// ---------- main ----------

async function main() {
  const all = await readAll("restaurants");
  const cats = args.category?.split(",").map((c) => c.trim()).filter(Boolean);
  const queue = all.filter((r) =>
    args.id ? r.id === args.id
      : r.website && (!args.area || r.area === args.area) && (!cats || cats.includes(r.category ?? "")) && (r.menu_status === "missing" || (args.retry && r.menu_status === "failed")),
  ).slice(0, args.id ? 1 : Number(args.limit));
  if (!queue.length) return console.log("Nothing to do.");

  const client = args["dry-run"] ? null : new Anthropic();
  let loaded = 0;
  for (const r of queue) {
    console.log(`\n${r.name} — ${r.website}`);
    let status: Restaurant["menu_status"] = "failed";
    let menuUrl: string | null = null;
    let rows: MenuItem[] = [];
    try {
      const src = await findMenu(r);
      if (!src) { console.log("  no menu page found"); }
      else {
        menuUrl = src.url;
        console.log(`  source: ${src.url} (${src.kind}${src.kind === "html" ? `, ${src.text.length} chars` : ""})`);
        if (client) {
          const menu = await extract(client, r, src);
          rows = menuRows(r.id, menu, { url: src.url, kind: src.kind === "pdf" ? "pdf" : "web" }, DishTypes);
          status = rows.length >= 3 ? "loaded" : "needs_photo";
          console.log(`  ${rows.length} dishes in ${menu.sections.length} sections → ${status}`);
        } else {
          status = r.menu_status; // dry run: don't change status
        }
      }
    } catch (e) {
      console.log(`  failed: ${(e as Error).message}`);
    }

    if (!client) continue;
    await saveMenu(r.id, rows, menuUrl, status);
    if (status === "loaded") loaded++;
  }
  if (client) console.log(`\nLoaded ${loaded} of ${queue.length} menus.`);
}

await main();
