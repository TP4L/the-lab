/*
 * Two phones, one event. Proves the thing the whole build is for: a score
 * entered on one device shows up on another without a reload, and reaching the
 * target takes over both screens.
 *
 *   node build.mjs && node test/live.test.mjs
 *
 * Needs playwright and a Chromium; set CHROME to point at one.
 */
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 8901;
const BASE = `http://localhost:${PORT}`;
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log("ok   " + name);
  else { fails++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
};

const server = spawn(process.execPath, ["test/devserver.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((done) => server.stdout.on("data", (d) => String(d).includes("dev server") && done()));

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

async function phone(label) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // The sandbox has no egress; don't wait on webfonts that cannot load.
  await context.route(
    (url) => url.hostname.endsWith("googleapis.com") || url.hostname.endsWith("gstatic.com"),
    (route) => route.abort(),
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => { fails++; console.log(`FAIL page error on ${label}: ${e.message}`); });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.store && window.store.mode === "cloud", null, { timeout: 15000 });
  return page;
}

const waitFor = (page, fn, timeout = 12000) => page.waitForFunction(fn, null, { timeout });

try {
  const a = await phone("A");
  const b = await phone("B");

  check("both phones reached the hosted scoreboard", [
    await a.evaluate(() => store.mode),
    await b.evaluate(() => store.mode),
  ], ["cloud", "cloud"]);

  // ── check in from each phone ──
  await a.click('[data-join="7"]');
  await waitFor(a, () => store.players[7] && store.players[7].num === 7);
  check("phone A is player 7", await a.evaluate(() => you().num), 7);

  await waitFor(b, () => !!store.players[7]);
  check("phone B sees A's check-in without reloading", await b.evaluate(() => !!store.players[7]), true);

  await b.click('[data-join="9"]');
  await waitFor(b, () => you() && you().num === 9);
  check("phone B is player 9", await b.evaluate(() => you().num), 9);

  // ── a phone cannot take a number that is already claimed ──
  const takenA = await a.evaluate(() => !!document.querySelector('[data-join="9"]'));
  check("A's card screen has no join grid to steal from", takenA, false);

  // ── report a game from phone A ──
  await a.click('[data-go="score"]');
  await a.click('[data-add="1"]');
  await a.click('[data-pick="1:7"]');
  await a.click('[data-add="2"]');
  await a.click('[data-pick="2:9"]');
  await a.fill("#score1", "11");
  await a.fill("#score2", "6");
  await a.click("[data-submit]");
  await waitFor(a, () => Object.keys(store.games).length === 1);

  await waitFor(b, () => Object.keys(store.games).length === 1);
  const bBoard = await b.evaluate(() => {
    const rows = standings().rows;
    return rows.map((r) => [r.num, r.points]);
  });
  check("phone B has the score seconds later, no reload", bBoard, [[7, 11], [9, 6]]);

  // ── the player QR carries a deep link to this very page ──
  const payload = await a.evaluate(() => playerPayload(7));
  check("player QR deep-links to the hosted page", payload, `${BASE}/#add=7`);

  // ── scanning that link adds the player to a score card ──
  await b.goto(`${BASE}/#add=7`, { waitUntil: "domcontentloaded" });
  await waitFor(b, () => store.mode === "cloud");
  await waitFor(b, () => ui.entry.s1.concat(ui.entry.s2).includes(7));
  check("opening a player link stages that player", await b.evaluate(() => ui.entry.s1), [7]);

  // ── race to the target ──
  await a.evaluate(() => putMeta({ target: 20 }));
  await waitFor(a, () => meta().target === 20);
  await a.evaluate(() =>
    apiPost("putGame", { game: { s1: [7], s2: [9], p1: 11, p2: 2 } }),
  );
  await waitFor(a, () => standings().champs.length === 1);
  check("first past the target is champion", await a.evaluate(() => standings().champs), [7]);

  await waitFor(a, () => !document.getElementById("champion").hidden);
  await waitFor(b, () => !document.getElementById("champion").hidden);
  const banner = await b.evaluate(() => document.getElementById("champion").innerText.replace(/\s+/g, " ").trim());
  check("both screens announce it", /CHAMPION/i.test(banner) && /7/.test(banner), true);

  // ── undo puts the event back ──
  const lastGame = await a.evaluate(() => standings().log[standings().log.length - 1].id);
  await a.evaluate((id) => dropGame(id), lastGame);
  await waitFor(a, () => standings().champs.length === 0);
  check("undo un-crowns the champion everywhere", await a.evaluate(() => standings().champs), []);
  await waitFor(b, () => standings().champs.length === 0);
  check("phone B agrees", await b.evaluate(() => standings().champs), []);
} finally {
  await browser.close();
  server.kill();
}

console.log(fails ? `\n${fails} FAILED` : "\nlive sync verified across two devices");
process.exit(fails ? 1 : 0);
