# The Lab

A decision engine for reading a situation and choosing one action — and a coach
that runs it.

## Core equation

```
Shot Possibility = Height × Time × Balance
```

A product, not a sum. Any factor at zero is a zero. Defending means collapsing
the cheapest factor; attacking means buying the one you're short of.

## Pipeline

```
Context → See → Read(H×T×B + Orientation + Certainty)
→ State(Defensive / Neutral / Offensive; Scramble = condition layer, not a 4th state)
→ Need(Survive → Recover → Stabilize → Build → Pressure → Finish)
→ Solve(Risk / Consequence / Cost / Target)
→ Predict → Organize(Move / Cover / Recover) → Reassess → Adapt
```

## Outer layers

Tempo · Initiative · Recovery Debt · Threat · Pattern Memory ·
Error Classification · Cost · Pace · Pressure

Reference lenses for explaining *why* a sound solve still failed. Not pipeline
stages — don't force them into the order.

## Vocabulary

Used exactly, never paraphrased:

Respect the X · The Triangle (speedup → counter → exit) · Own space not lines ·
Go Stay Go · Hip Pocket Over · Cover Cover Sit · Oh Slide Go

## Using the coach

The coach ships as a Claude Code skill. Describe a situation and it returns four
parts, nothing more:

```
1. Read       — H/T/B assessment
2. State + Need
3. Action     — one specific action, in the vocabulary above
4. Why        — one line
```

Invoke it with `/lab-coach`, or just describe a rep and let it trigger.

## Companion app: LAB Sideline

`companion/` is a full-stack coaching app built on the engine. It has a Node server,
a SQLite database and a phone-first web front end. There are no dependencies to
install; it needs Node 22.13 or newer (SQLite is built into Node).

```
cd companion
npm start          # http://localhost:8787
npm test           # engine + API tests
```

| Screen | What it does |
|---|---|
| **Home** | Team dashboard: film accuracy, errors logged across the roster, which stage to coach first, most-missed film, next practice. |
| **Call** | Tap in the Read, State, Need and solve inputs. Returns the four-part output and every call's legality. Save any read as a film situation. |
| **Players** | Roster and player profiles: film accuracy overall and by call, an error log with classification (See to Execution), and what to coach first. |
| **Film** | Situation library filtered by position and state, a situation editor with a live answer preview, and film sessions that save to a player's profile. |
| **Drills** | On-field drills keyed to the call they train, filtered by call and position. Add any drill to a practice plan. |
| **Plans** | Practice plans: ordered drills with minutes and a running clock. |

**How it works.** `companion/web/engine.js` is the decision engine. The browser and
the server both load that same file, so the Call screen and the server's film
grading always agree. The server grades film answers itself, so a client can't
submit its own answer key.

**Configuration** (environment variables):

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `LAB_DB` | `companion/data/lab.db` | SQLite file |
| `COACH_KEY` | unset | When set, adding, editing and deleting require this key (entered once per device from the header). Reading and running film sessions stay open. |
| `LAB_DEMO` | `1` | On a fresh database, also load three demo players, clearly marked, so the dashboard isn't empty. Set `0` to skip. Clear them any time from Players. |

A `Dockerfile` is included. Mount a volume at `/data` to keep the database.

**Starter content.** The first four film situations are the worked examples. The
other situations, the ten drills and the sample plan are starter content to edit
into your program. Legality comes from `reference/vocabulary.md`. When more than one
call is legal, the engine's preference order is its own reading and should be
corrected in place, like the vocabulary notes.

## Layout

| Path | What's in it |
|---|---|
| `companion/` | LAB Sideline: server, database, web app, tests |
| `site/index.html` | Readable reference page for the engine |
| `.claude/skills/lab-coach/SKILL.md` | The coach: equation, pipeline, output contract |
| `.claude/skills/lab-coach/reference/pipeline.md` | Each stage in depth |
| `.claude/skills/lab-coach/reference/outer-layers.md` | The nine lenses, incl. Error Classification table |
| `.claude/skills/lab-coach/reference/vocabulary.md` | When each call is legal — state, Need rung, layer |
| `.claude/skills/lab-coach/reference/examples.md` | Four worked situations, pipeline trace + output |

## A note on the vocabulary file

`vocabulary.md` records **when each call is legal** — which Read, State, and Need
rung it belongs to. Where a note reads as a mechanical gloss of the call itself,
it's an inference from the framework's structure, not doctrine. Correct those in
place; the calls and the situations they fit are the durable part.
