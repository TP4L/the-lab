/*
 * Runs the real serverless function outside Netlify.
 *
 * `@netlify/blobs` refuses to load without Netlify's environment, so the
 * function is copied next to a stand-in package that keeps the same ETag and
 * conditional-write semantics. The function's own code is never modified —
 * what the tests exercise is exactly what deploys.
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const FAKE_BLOBS = `
let data = null, tag = 0;
export const __reset = () => { data = null; tag = 0; };
export const __raw = () => data;
export function getStore() {
  return {
    async getWithMetadata() {
      if (data === null) return null;
      return { data: JSON.parse(JSON.stringify(data)), etag: String(tag), metadata: {} };
    },
    async setJSON(key, value, opts = {}) {
      if (opts.onlyIfNew && data !== null) return { modified: false };
      if (opts.onlyIfMatch != null && opts.onlyIfMatch !== String(tag)) return { modified: false };
      data = JSON.parse(JSON.stringify(value));
      tag++;
      return { modified: true, etag: String(tag) };
    },
  };
}
`;

export async function loadFunction() {
  const sandbox = resolve(root, "test/.sandbox");
  await rm(sandbox, { recursive: true, force: true });
  await mkdir(resolve(sandbox, "node_modules/@netlify/blobs"), { recursive: true });
  await mkdir(resolve(sandbox, "node_modules/@netlify/functions"), { recursive: true });

  await writeFile(resolve(sandbox, "package.json"), '{"type":"module","private":true}');
  await writeFile(
    resolve(sandbox, "node_modules/@netlify/blobs/package.json"),
    '{"name":"@netlify/blobs","type":"module","exports":"./index.mjs"}',
  );
  await writeFile(resolve(sandbox, "node_modules/@netlify/blobs/index.mjs"), FAKE_BLOBS);
  await writeFile(
    resolve(sandbox, "node_modules/@netlify/functions/package.json"),
    '{"name":"@netlify/functions","type":"module","exports":"./index.mjs"}',
  );
  await writeFile(resolve(sandbox, "node_modules/@netlify/functions/index.mjs"), "export {};");

  await cp(resolve(root, "netlify/functions/event.mts"), resolve(sandbox, "event.mts"));

  const mod = await import(pathToFileURL(resolve(sandbox, "event.mts")).href);
  const blobs = await import(pathToFileURL(resolve(sandbox, "node_modules/@netlify/blobs/index.mjs")).href);
  return { handler: mod.default, config: mod.config, blobs };
}
