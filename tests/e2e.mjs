// End-to-end check of the core loop against a running server.
//   cp -r data /tmp/hork-test && HORK_DATA_DIR=/tmp/hork-test PORT=3100 npm start
//   HORK_DATA_DIR=/tmp/hork-test node tests/e2e.mjs      (needs `npm i -D playwright` + a Chromium;
//   set CHROME_PATH to use an already-installed Chrome/Chromium)
// Never point it at the real data/ folder: it creates users and logs.
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const base = process.env.BASE_URL ?? "http://localhost:3100";
const dataDir = process.env.HORK_DATA_DIR;
if (!dataDir) throw new Error("Set HORK_DATA_DIR to the server's test data copy");
const shots = process.env.SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "hork-shots-"));
const r = JSON.parse(fs.readFileSync(path.join(dataDir, "restaurants.json"), "utf8")).find((x) => x.name === "Barbrix");
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const mk = async () => browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: r.lat, longitude: r.lng }, permissions: ["geolocation"] });
const check = (c, m) => { if (!c) { throw new Error("FAIL: " + m); } console.log("ok -", m); };

// Beth: home → sign in → Barbrix → log THE Hamburger as love with note
const a = await mk(); const p = await a.newPage();
await p.goto(base + "/");
await p.waitForSelector("a.card");
const first = await p.locator("a.card").first().innerText();
check(first.includes("Barbrix"), `nearest restaurant is Barbrix (got: ${first.split("\n")[0]})`);
await p.screenshot({ path: `${shots}/1-here.png`, fullPage: false });
await p.goto(base + "/me");
await p.fill("#handle", "beth"); await p.fill("#display_name", "Beth"); await p.click("button[type=submit]");
await p.waitForURL(base + "/");
await p.locator("a.card", { hasText: "Barbrix" }).first().click();
await p.waitForSelector("h1:has-text('Barbrix')");
await p.screenshot({ path: `${shots}/2-menu.png`, fullPage: false });
await p.locator("li.card", { hasText: "THE Hamburger" }).getByText("I ate this").click();
await p.click(`label[for=${("#v-love").slice(1)}]`); await p.fill("#note", "Get the fries + bearnaise");
await p.screenshot({ path: `${shots}/3-log.png` });
await p.click("button[type=submit]");
await p.waitForSelector(".notice");
check((await p.locator("li.card", { hasText: "THE Hamburger" }).innerText()).includes("♥ 1"), "hamburger shows 1 love");
for (const [dish, v] of [["Ricotta Gnocchi", "love"], ["Cioppino", "skip"]]) {
  await p.locator("li.card", { hasText: dish }).getByText("I ate this").click();
  await p.click(`label[for=${(`#v-${v}`).slice(1)}]`); await p.click("button[type=submit]"); await p.waitForSelector(".notice");
}

// Lester and Sam also rate the burger so it earns a badge (3 ratings)
for (const [h, v] of [["sam", "love"], ["lester", "love"]]) {
  const c = await mk(); const q = await c.newPage();
  await q.goto(base + "/me"); await q.fill("#handle", h); await q.click("button[type=submit]"); await q.waitForURL(base + "/");
  await q.goto(`${base}/r/${r.id}`);
  await q.locator("li.card", { hasText: "THE Hamburger" }).getByText("I ate this").click();
  await q.waitForURL(/\/log\//);
  await q.click(`label[for=${(`#v-${v}`).slice(1)}]`); await q.click("button[type=submit]"); await q.waitForSelector(".notice");
  if (h === "lester") {
    await q.goto(base + "/people");
    await q.locator("li.card", { hasText: "Beth" }).getByRole("button", { name: "Follow" }).click();
    await q.waitForSelector("li.card:has-text('Beth') >> text=Following");
    await q.goto(base + "/stream");
    const s = await q.locator("main").innerText();
    check(s.includes("Beth") && s.includes("Get the fries"), "Lester's friends stream shows Beth's note");
    await q.screenshot({ path: `${shots}/4-stream.png` });
    await q.goto(`${base}/r/${r.id}`);
    const card = await q.locator("li.card", { hasText: "THE Hamburger" }).innerText();
    check(card.includes("Top pick") && card.includes("Beth"), "burger is a Top pick with Beth's verdict shown to Lester");
    await q.screenshot({ path: `${shots}/5-menu-after.png` });
    await q.goto(`${base}/best?type=burger&lat=${r.lat}&lng=${r.lng}`);
    const b = await q.locator("ol.list li").first().innerText();
    check(b.includes("THE Hamburger") && b.includes("Barbrix"), "best burger near me ranks Barbrix's burger first");
    await q.screenshot({ path: `${shots}/6-best.png` });
    await q.goto(`${base}/u/beth`);
    const u = await q.locator("main").innerText();
    check(u.includes("THE Hamburger") && u.includes("Ricotta Gnocchi") && !u.includes("Cioppino"), "Beth's profile lists only dishes she loved");
  }
}
// Off-menu dish
await p.goto(`${base}/r/${r.id}`);
await p.click("summary"); await p.fill("#name", "Off-menu smash burger"); await p.selectOption("#dish_type", "burger");
await p.click("form:has(#name) button[type=submit]");
await p.waitForURL(/\/log\//); await p.click(`label[for=${("#v-fine").slice(1)}]`); await p.click("button[type=submit]"); await p.waitForSelector(".notice");
check((await p.locator("main").innerText()).toLowerCase().includes("added by diners"), "off-menu dish appears under Added by diners");
await browser.close();
console.log("ALL PASSED");
