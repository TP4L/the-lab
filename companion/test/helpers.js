'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createApp } = require('../server/index.js');

async function start(opts = {}) {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-media-'));
  const resets = [];
  const app = createApp({ file: ':memory:', mediaDir, adminEmail: 'owner@lab.test', publicUrl: 'http://lab.test', onResetLink: (e, l) => resets.push({ email: e, link: l }), ...opts });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  function client() {
    let cookie = '';
    async function call(method, p, body, headers = {}) {
      const isBuf = Buffer.isBuffer(body);
      const res = await fetch(base + p, {
        method,
        headers: { ...(body !== undefined && !isBuf ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body === undefined ? undefined : (isBuf || typeof body === 'string' ? body : JSON.stringify(body))
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      const type = res.headers.get('content-type') || '';
      const out = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
      return { status: res.status, body: out, headers: res.headers };
    }
    return {
      call,
      get: (p, h) => call('GET', p, undefined, h),
      post: (p, b, h) => call('POST', p, b === undefined ? {} : b, h),
      put: (p, b) => call('PUT', p, b),
      del: p => call('DELETE', p),
      async signup(name, email, password = 'correct horse battery') { return call('POST', '/api/auth/signup', { name, email, password }); }
    };
  }

  const close = () => new Promise(r => app.server.close(() => { fs.rmSync(mediaDir, { recursive: true, force: true }); r(); }));
  return { base, client, close, resets, app };
}

/* Owner (admin) plus a coach, contributor and editor, promoted through the admin API. */
async function staff(s) {
  const owner = s.client(); await owner.signup('Owner', 'owner@lab.test');
  const mk = async (name, email, roles) => {
    const c = s.client();
    const u = (await c.signup(name, email)).body.user;
    await owner.put(`/api/admin/users/${u.id}/roles`, { roles });
    return c;
  };
  return {
    owner,
    coach: await mk('Coach Kim', 'coach@lab.test', ['athlete', 'coach']),
    coach2: await mk('Coach Other', 'coach2@lab.test', ['athlete', 'coach']),
    writer: await mk('Writer', 'writer@lab.test', ['athlete', 'contributor']),
    editor: await mk('Editor', 'editor@lab.test', ['athlete', 'editor'])
  };
}

const uid = () => crypto.randomUUID();
module.exports = { start, staff, uid };
