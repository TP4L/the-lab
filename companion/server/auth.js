'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('./http.js');

const ROLES = ['athlete', 'coach', 'contributor', 'editor', 'admin'];
const SESSION_DAYS = 30;
const COOKIE = 'lab_session';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  if (String(stored).startsWith('oauth$')) return false; // Google-only account: no password yet
  const [alg, s, h] = String(stored).split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const want = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(s, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}
const sha256 = v => crypto.createHash('sha256').update(v).digest('hex');
const token = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/* Human-typable claim code: 8 chars from an alphabet without look-alikes. */
function claimCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += A[b[i] % A.length];
  return s.slice(0, 4) + '-' + s.slice(4);
}
const normalizeCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/* Fixed-window rate limiter held in memory. */
function limiter(max, windowMs) {
  const hits = new Map();
  return key => {
    const t = Date.now();
    const e = hits.get(key);
    if (!e || t - e.start > windowMs) { hits.set(key, { start: t, n: 1 }); return true; }
    e.n++;
    if (hits.size > 10000) hits.clear();
    return e.n <= max;
  };
}

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function createAuth(db, { secureCookies = false } = {}) {
  function userRow(u) {
    if (!u) return null;
    const roles = JSON.parse(u.roles);
    const staff = db.prepare('SELECT email FROM website_staff_connections WHERE user_id=? AND expires_at>?').get(u.id,Date.now());
    const trusted = staff && ['brettadamstp@gmail.com','austinajie@gmail.com'].includes(staff.email) && staff.email === u.email.toLowerCase();
    if (trusted) for (const role of ['coach','contributor','editor', ...(staff.email==='brettadamstp@gmail.com'?['admin']:[])]) if (!roles.includes(role)) roles.push(role);
    return { id: u.id, email: u.email, name: u.name, roles, workspace: !!trusted, created_at: u.created_at };
  }

  function startSession(userId) {
    const t = token();
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
    db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(t), userId, expires);
    return { token: t, cookie: `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secureCookies ? '; Secure' : ''}` };
  }
  function endSession(req) {
    const t = readToken(req);
    if (t) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(t));
    return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`;
  }
  function readToken(req) {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) return h.slice(7);
    return parseCookies(req.headers.cookie)[COOKIE] || null;
  }
  function currentUser(req) {
    const t = readToken(req);
    if (!t) return null;
    const row = db.prepare(`SELECT u.* FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(t), new Date().toISOString());
    return userRow(row);
  }

  const has = (user, ...roles) => !!user && (user.roles.includes('admin') || roles.some(r => user.roles.includes(r)));
  function require(user, ...roles) {
    if (!user) throw new HttpError(401, 'Sign in to continue.');
    if (roles.length && !has(user, ...roles)) throw new HttpError(403, 'Your account doesn’t have access to this.');
    return user;
  }

  /* The athlete record linked to this account, if any. */
  function ownAthleteId(user) {
    if (!user) return null;
    const r = db.prepare('SELECT id FROM athletes WHERE user_id = ?').get(user.id);
    return r ? r.id : null;
  }
  /* Coaches see athletes they're assigned to; admins see everyone. */
  function coachesAthlete(user, athleteId) {
    if (!user) return false;
    if (user.roles.includes('admin')) return true;
    if (!user.roles.includes('coach')) return false;
    if (user.workspace) return true;
    return !!db.prepare('SELECT 1 FROM coach_athletes WHERE coach_id = ? AND athlete_id = ?').get(user.id, athleteId);
  }
  /* 'coach' = full access incl. private notes; 'self' = the athlete; null = none. */
  function athleteAccess(user, athleteId) {
    if (coachesAthlete(user, athleteId)) return 'coach';
    if (user && ownAthleteId(user) === Number(athleteId)) return 'self';
    return null;
  }

  return { userRow, startSession, endSession, currentUser, has, require, ownAthleteId, coachesAthlete, athleteAccess };
}

module.exports = { ROLES, hashPassword, verifyPassword, sha256, token, claimCode, normalizeCode, limiter, createAuth };
