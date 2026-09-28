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

## THE LAB app

`companion/` is the shared backend and the installable app for
trainwiththelab.com. It has one set of accounts and one athlete record per
person, with training results and published posts behind one API. It is
written for pickleball.

```
cd companion
ADMIN_EMAIL=you@example.com npm start   # http://localhost:8787
npm test                                # API journeys, Play, accounts, engine
```

The first account created with `ADMIN_EMAIL` becomes the admin. Everyone else
signs up as an athlete, and admins grant coach, contributor and editor roles.
It needs Node 22.13 or newer and has no dependencies.

| Tab | What's in it |
|---|---|
| **Home** | Current focus, assigned training, recent sessions, notes from your coach, upcoming events, continue learning, new Field Notes, staff shortcuts. |
| **Train** | Scoreboard Studio: 1–10 drills measured by make/miss, score, time or feel. One-player and four-player counters, custom scoreboards (timed, best-of), templates, assigned training, session notes, voice scoring (experimental). |
| **Play** | Matches with confirmation, disputes, verification and corrections. Events in eight formats (Round Robin, Race to, Pre-Mapped Doubles, Unlucky, Rivalry, Fixed Partners, 3v3 Team Draft, Fallout), sign-up links that need no account, player and spectator pages, QR check-in, walk-ins, breaks, timed rounds, single and double elimination, live courts, standings, leaderboard. |
| **Learn** | Field Notes with rich text, courses and lessons (everyone, members or cohort), progress, saved posts, the decision engine. |
| **Profile** | Player card with check-in QR, claiming, goals, coach notes, reflections, results, notification settings (including phone push), account and privacy, account deletion. |
| **Coach Workspace** | Roster, claim codes, private vs shared notes, media, templates, assigning training, cohorts. The Events desk: Pending Interest (find the group before picking a date), Team Planner (invitations, court blocks, player recaps) and live events. |
| **Publishing Studio** | Posts and courses: drafts, uploads, preview, review, schedule, publish, revisions. |
| **Admin** | Roles, membership, reset links, system status, backups. |

It installs to the home screen and works offline. Scores, notes, reflections
and drafts save on the device and sync without duplicates.

**Optional services** (set in Render, all off by default): `RESEND_API_KEY` and
`MAIL_FROM` for password-reset emails; `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
and `VAPID_SUBJECT` for phone notifications (generate them with `node
server/push.js --keys`); `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` for
Sign in with Google. Admin → System shows which are on.

**Deploying (Render).** `render.yaml` at the repo root is a Render Blueprint.
In the Render dashboard choose **New → Blueprint**, connect this repo and pick
the branch. When asked, set `ADMIN_EMAIL` (the account that becomes admin) and
`PUBLIC_URL` (for example `https://the-lab.onrender.com`). It runs on the
Starter plan with a 1 GB disk at `/data` for the database and uploads, about
$7–8 a month. Render's free plan has no disk, so data would be lost on every
restart.

- `companion/docs/API.md` is the contract the website should build against.
- `companion/docs/PARITY.md` lists what's done, what needs infrastructure, and
  what remains before the iOS and Android releases.

## Layout

| Path | What's in it |
|---|---|
| `companion/` | THE LAB app: shared backend, installable app, tests, API docs |
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
