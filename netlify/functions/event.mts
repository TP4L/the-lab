import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

/*
 * The shared scoreboard for one Race to 50 night.
 *
 * The whole event is a few kilobytes, so it lives in a single blob and every
 * write is conditional on the ETag we read: two scorers submitting in the same
 * second retry rather than overwrite each other. Reads are strongly consistent
 * because a scorer who just submitted has to see their own game on the board.
 *
 * Totals and the champion are NOT stored. The client derives them from the game
 * log, so an undo is exact and there is no counter to drift.
 */

const STORE = "race-to-50";
const KEY = "state";
const MAX_GAMES = 400;
const MAX_PLAYERS = 60;
const RETRIES = 6;

type Player = { num: number; name: string; device: string; joinedAt: number };
type Game = {
  id: string;
  s1: number[];
  s2: number[];
  p1: number;
  p2: number;
  at: number;
  court: number;
};
type State = {
  v: number;
  meta: Record<string, string | number>;
  players: Record<string, Player>;
  games: Record<string, Game>;
  adminPin?: string;
};

const blank = (): State => ({ v: 0, meta: {}, players: {}, games: {} });

const store = () => getStore({ name: STORE, consistency: "strong" });

/* ── input scrubbing: this endpoint is open to anyone with the link ── */
const int = (value: unknown, lo: number, hi: number, fallback = 0): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

const text = (value: unknown, max: number): string =>
  String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);

const exact = (value: unknown, lo: number, hi: number): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < lo || n > hi) return 0;
  return n;
};

const sideOf = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const raw of value.slice(0, 2)) {
    const n = exact(raw, 1, MAX_PLAYERS);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
};

const link = (value: unknown): string => {
  const raw = text(value, 300);
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : "";
};

/* ── what a client is allowed to see ── */
const publish = (state: State) => ({
  v: state.v || 0,
  pinSet: !!state.adminPin,
  state: { meta: state.meta || {}, players: state.players || {}, games: state.games || {} },
});

async function read(): Promise<{ state: State; etag: string | null }> {
  const hit = await store().getWithMetadata(KEY, { type: "json" });
  if (!hit || !hit.data) return { state: blank(), etag: null };
  const state = hit.data as State;
  return {
    state: {
      v: state.v || 0,
      meta: state.meta || {},
      players: state.players || {},
      games: state.games || {},
      adminPin: state.adminPin,
    },
    etag: hit.etag ?? null,
  };
}

/*
 * Apply `change` to the current state and write it back only if nobody else
 * wrote in between. `change` returns an error code to reject the whole thing.
 */
async function mutate(change: (state: State) => string | void) {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const { state, etag } = await read();
    const failure = change(state);
    if (failure) return { error: failure };

    state.v = (state.v || 0) + 1;
    const conditions = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const result = await store().setJSON(KEY, state, conditions);

    // `modified === false` means somebody else got there first — re-read and
    // reapply. An older runtime without conditional writes returns no flag.
    if (result?.modified !== false) return { ok: publish(state) };
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 140));
  }
  return { error: "busy" };
}

const needsPin = (state: State, given: unknown): boolean =>
  !!state.adminPin && text(given, 12) !== state.adminPin;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req: Request, _context: Context) => {
  if (req.method === "GET") {
    const known = Number(new URL(req.url).searchParams.get("v"));
    const { state } = await read();
    const current = publish(state);
    if (Number.isFinite(known) && known > 0 && known === current.v) {
      return json({ v: current.v, unchanged: true });
    }
    return json(current);
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad-json" }, 400);
  }

  const op = String(body.op || "");
  let outcome: { ok?: unknown; error?: string };

  switch (op) {
    /* A number is claimed once. Doing the check inside the conditional write is
       what stops two phones both believing they are #7. */
    case "claim": {
      const num = exact(body.num, 1, MAX_PLAYERS);
      const device = text(body.device, 40);
      const name = text(body.name, 18);
      if (!num || !device) return json({ error: "bad-input" }, 400);

      outcome = await mutate((state) => {
        const held = state.players[num];
        if (held && held.device && held.device !== device) return "taken";
        if (Object.keys(state.players).length >= MAX_PLAYERS && !held) return "full";

        for (const key of Object.keys(state.players)) {
          if (state.players[key].device === device && Number(key) !== num) {
            delete state.players[key];
          }
        }
        state.players[num] = { num, name, device, joinedAt: held?.joinedAt || Date.now() };
      });
      break;
    }

    case "rename": {
      const num = exact(body.num, 1, MAX_PLAYERS);
      const device = text(body.device, 40);
      const name = text(body.name, 18);
      if (!num || !device) return json({ error: "bad-input" }, 400);

      outcome = await mutate((state) => {
        const held = state.players[num];
        if (!held) return "missing";
        if (held.device && held.device !== device) return "not-yours";
        held.name = name;
      });
      break;
    }

    case "putGame": {
      const s1 = sideOf((body.game as Game)?.s1);
      const s2 = sideOf((body.game as Game)?.s2);
      const p1 = int((body.game as Game)?.p1, 0, 99, 0);
      const p2 = int((body.game as Game)?.p2, 0, 99, 0);
      const court = int((body.game as Game)?.court, 1, 12, 1);
      if (!s1.length || !s2.length) return json({ error: "needs-players" }, 400);
      if (s1.some((n) => s2.includes(n))) return json({ error: "same-player" }, 400);
      if (p1 === 0 && p2 === 0) return json({ error: "needs-points" }, 400);

      outcome = await mutate((state) => {
        if (Object.keys(state.games).length >= MAX_GAMES) return "full";
        const id = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        state.games[id] = { id, s1, s2, p1, p2, at: Date.now(), court };
        // Somebody scored on without checking in still belongs on the board.
        for (const num of s1.concat(s2)) {
          if (!state.players[num]) {
            state.players[num] = { num, name: "", device: "", joinedAt: Date.now() };
          }
        }
      });
      break;
    }

    case "dropGame": {
      const id = text(body.id, 40);
      if (!id) return json({ error: "bad-input" }, 400);
      outcome = await mutate((state) => {
        delete state.games[id];
      });
      break;
    }

    case "setMeta": {
      const patch = (body.patch || {}) as Record<string, unknown>;
      outcome = await mutate((state) => {
        if (needsPin(state, body.pin)) return "pin";
        const meta = state.meta;
        if ("name" in patch) meta.name = text(patch.name, 40) || "Race to 50";
        if ("target" in patch) meta.target = int(patch.target, 1, 500, 50);
        if ("maxPlayers" in patch) meta.maxPlayers = int(patch.maxPlayers, 2, MAX_PLAYERS, 18);
        if ("courts" in patch) meta.courts = int(patch.courts, 1, 12, 3);
        if ("gameMinutes" in patch) meta.gameMinutes = int(patch.gameMinutes, 1, 60, 10);
        if ("link" in patch) meta.link = link(patch.link);
      });
      break;
    }

    /* Setting a PIN the first time is open; changing it needs the old one. */
    case "setPin": {
      outcome = await mutate((state) => {
        if (needsPin(state, body.current)) return "pin";
        const next = text(body.pin, 12);
        if (next) state.adminPin = next;
        else delete state.adminPin;
      });
      break;
    }

    case "reset": {
      outcome = await mutate((state) => {
        if (needsPin(state, body.pin)) return "pin";
        state.players = {};
        state.games = {};
      });
      break;
    }

    default:
      return json({ error: "unknown-op" }, 400);
  }

  if (outcome.error) {
    const status = outcome.error === "pin" ? 403 : outcome.error === "busy" ? 503 : 409;
    return json({ error: outcome.error }, status);
  }
  return json(outcome.ok);
};

export const config: Config = {
  path: "/api/event",
};
