/*
 * The site, served locally: static files from public/, /api/event handled by
 * the real function against an in-memory store. Enough to open the app in a
 * browser — or two — without deploying.
 *
 *   node build.mjs && node test/devserver.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFunction } from "./harness.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8899);

const { handler } = await loadFunction();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/event") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const init = { method: req.method, headers: req.headers };
    if (chunks.length) init.body = Buffer.concat(chunks);

    const response = await handler(new Request(url.href, init), {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    return;
  }

  try {
    const body = await readFile(resolve(root, "public/index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("build first: node build.mjs");
  }
});

server.listen(PORT, () => console.log(`race-to-50 dev server: http://localhost:${PORT}`));
