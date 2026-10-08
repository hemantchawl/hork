/** Print the cleaned text the loader would send to Claude for a URL (from data/cache when available). */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { DATA_DIR } from "../lib/store";

const url = process.argv[2];
const key = createHash("sha1").update(url).digest("hex");
const html = await fs.readFile(path.join(DATA_DIR, "cache", key), "utf8");
const $ = cheerio.load(html);
$("script, style, noscript, svg, iframe, header nav, footer").remove();
$("br").replaceWith("\n");
$("p, li, h1, h2, h3, h4, h5, h6, div, tr, section, article").each((_, el) => { $(el).append("\n"); });
console.log($("body").text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim());
