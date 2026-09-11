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

## Layout

| Path | What's in it |
|---|---|
| `.claude/skills/lab-coach/SKILL.md` | The coach: equation, pipeline, output contract |
| `.claude/skills/lab-coach/reference/pipeline.md` | Each stage in depth |
| `.claude/skills/lab-coach/reference/outer-layers.md` | The nine lenses, incl. Error Classification table |
| `.claude/skills/lab-coach/reference/vocabulary.md` | When each call is legal — state, Need rung, layer |
| `.claude/skills/lab-coach/reference/examples.md` | Four worked situations, pipeline trace + output |
| `site/index.html` | The decision engine as a readable web page |
| `site/race-to-50.html` | Race to 50 — the live event app (check-in, QR player cards, scoring, leaderboard) |
| `netlify/functions/event.mts` | The shared scoreboard API for the hosted deploy |
| `build.mjs` | Wraps the app page into a standalone `public/index.html` |
| `test/` | Scoring logic, the API, and a two-browser live-sync check |

## A note on the vocabulary file

`vocabulary.md` records **when each call is legal** — which Read, State, and Need
rung it belongs to. Where a note reads as a mechanical gloss of the call itself,
it's an inference from the framework's structure, not doctrine. Correct those in
place; the calls and the situations they fit are the durable part.

## Race to 50

`site/race-to-50.html` runs an event night. Players check in by paddle
number and get a QR player card; a scorer adds each side and the points
they scored; the leaderboard updates live on every phone and calls out
who is closest to 50. When someone gets there, every screen says so.

Totals and the champion are derived from the game log rather than kept as
counters, so undo is exact and simultaneous reports can't corrupt a
running total. QR codes are generated in-page, so a player's card renders
with no network.

### Where the scoreboard lives

One source file, `site/race-to-50.html`, runs against whichever backend
answers:

| Backend | When | Who can see it |
|---|---|---|
| `/api/event` | Deployed to Netlify | Anyone with the link |
| Artifact database | Published as a Claude Artifact | Signed-in members of the org |
| This browser | Neither answered | Just that device |

Hosted, the page reads its own address, so the event QR code and every
player card work with no setup at all.

### Deploying

```
npm install
npm test          # scoring logic + the scoreboard API
npm run dev       # http://localhost:8899, real function, in-memory store
npm run test:live # two browsers, one event (needs: npm i -D playwright)
```

Netlify reads `netlify.toml`: `node build.mjs` wraps the source page into
`public/index.html`, and `netlify/functions/event.mts` serves `/api/event`
backed by Netlify Blobs. Point a Netlify project at this repo and it
builds with no further configuration.

The whole event is one blob, and every write is conditional on the ETag
that was read, so simultaneous reports from three courts retry instead of
overwriting each other. Anyone with the link can check in and report a
score — that is the format. Settings and "start a new event" sit behind an
organizer PIN set in Setup.
