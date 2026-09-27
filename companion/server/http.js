'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_JSON = 256 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const STATUS = Symbol('status');
const withStatus = (status, body) => ({ [STATUS]: status, body });

/* ---------- validation ---------- */
function str(v, field, { required = false, max = 2000 } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `${field} must be text.`);
  v = String(v).trim();
  if (required && !v) throw new HttpError(400, `${field} is required.`);
  if (v.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer.`);
  return v;
}
function oneOf(v, list, field, { allowEmpty = false } = {}) {
  if ((v === undefined || v === null || v === '') && allowEmpty) return '';
  if (!list.includes(v)) throw new HttpError(400, `${field} must be one of: ${list.join(', ')}.`);
  return v;
}
function int(v, field, { min = 0, max = 1e9, required = false } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} must be a whole number from ${min} to ${max}.`);
  return n;
}
function num(v, field, { min = -1e9, max = 1e9 } = {}) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${field} must be a number from ${min} to ${max}.`);
  return n;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v, field) {
  if (typeof v !== 'string' || !UUID.test(v)) throw new HttpError(400, `${field} must be a UUID.`);
  return v.toLowerCase();
}
function isoTime(v, field, { allowEmpty = true } = {}) {
  if ((v === undefined || v === null || v === '') && allowEmpty) return null;
  const d = new Date(v);
  if (typeof v !== 'string' || isNaN(d)) throw new HttpError(400, `${field} must be a date and time.`);
  return d.toISOString();
}
function list(v, field, { max = 20, item = x => x } = {}) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, `${field} must be a list.`);
  if (v.length > max) throw new HttpError(400, `${field} can have at most ${max} entries.`);
  return v.map((x, i) => item(x, `${field}[${i}]`));
}

/* ---------- router ---------- */
function createRouter() {
  const routes = [];
  function add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([A-Za-z0-9-]+)'; }) + '/?$');
    routes.push({ method, re, keys, handler, raw: !!opts.raw });
  }
  function match(method, pathname) {
    let pathHit = false;
    for (const r of routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathHit = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = m[i + 1]; });
      return { route: r, params };
    }
    return { pathHit };
  }
  return { add, match, get: (p, h, o) => add('GET', p, h, o), post: (p, h, o) => add('POST', p, h, o), put: (p, h, o) => add('PUT', p, h, o), del: (p, h, o) => add('DELETE', p, h, o) };
}

/* ---------- request/response ---------- */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size <= MAX_JSON) chunks.push(c);
      else if (size > MAX_JSON * 16) req.destroy();
    });
    req.on('end', () => {
      if (size > MAX_JSON) return reject(new HttpError(413, 'Request body is too large.'));
      if (!chunks.length) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!v || typeof v !== 'object' || Array.isArray(v)) return reject(new HttpError(400, 'Body must be a JSON object.'));
        resolve(v);
      } catch { reject(new HttpError(400, 'Body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY'
};

function send(res, status, data, headers = {}) {
  const base = { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', ...headers };
  if (data === null || data === undefined || status === 204) { res.writeHead(status === 200 && data == null ? 204 : status, base); return res.end(); }
  res.writeHead(status, { ...base, 'Content-Type': TYPES['.json'] });
  res.end(JSON.stringify(data));
}

function serveStatic(root, req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, { error: 'Bad path.' }); }
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return send(res, 404, { error: 'Not found.' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found.' });
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    };
    if (path.extname(file) === '.html') {
      headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    }
    if (path.basename(file) === 'sw.js') headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

module.exports = { HttpError, STATUS, withStatus, str, oneOf, int, num, uuid, isoTime, list, createRouter, readJson, send, serveStatic, SECURITY_HEADERS };
