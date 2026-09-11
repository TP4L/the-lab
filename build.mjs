/*
 * One app, two homes.
 *
 * `site/race-to-50.html` is the single source: page content with no document
 * wrapper, which is the shape the Artifact host expects. This wraps it in the
 * head that host would otherwise supply, so the same file also deploys to
 * Netlify as a standalone page.
 *
 * Run it with `node build.mjs`; Netlify runs it as the build command.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(root, "site/race-to-50.html");
const OUT = resolve(root, "public/index.html");

const body = await readFile(SOURCE, "utf8");

const title = (body.match(/<title>([^<]*)<\/title>/i) || [, "Race to 50"])[1];
const description =
  "Live scoring for The LAB's Race to 50. Check in by number, show your QR " +
  "player card, and follow who is closest to 50 in real time.";

/* The reset mirrors what the Artifact host injects, so the page renders
   identically in both places and nothing in the stylesheet has to care. */
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="${description}">
<meta name="theme-color" content="#060E17">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" rx="7" fill="#060E17"/>' +
    '<circle cx="16" cy="16" r="8.5" fill="#17A9F5"/>' +
    '<circle cx="13" cy="13" r="1.6" fill="#060E17"/>' +
    '<circle cx="19" cy="13" r="1.6" fill="#060E17"/>' +
    '<circle cx="13" cy="19" r="1.6" fill="#060E17"/>' +
    '<circle cx="19" cy="19" r="1.6" fill="#060E17"/>' +
    "</svg>",
)}">
<style>
:root{color-scheme:dark}
body{margin:0;font:14px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
img{max-width:100%}
[hidden]{display:none!important}
</style>
</head>
<body>
${body}</body>
</html>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, page, "utf8");
console.log(`build: ${OUT} (${(page.length / 1024).toFixed(1)} kB)`);
