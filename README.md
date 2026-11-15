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

## Performance dashboard

`public/performance.html` is the coach's view of the training floor: turf, weight
room and mat, drawn top-down on one screen. One surface is focused, the other two
stay live as minis, and the floor expands to full screen for a wall display.

- **Live · Replay · Heat · Plan** on every surface, with a scrubber over the hour.
- **Group on the floor, tap an athlete to drill in** — heart rate, today's results,
  personal bests, and their Stress Bowl.
- **Coach actions** — one-tap observations, a stopwatch that logs results, moving
  an athlete to another surface. The log is kept in the browser.
- **Stress Bowl** — the total-load and readiness framework. A coach planning
  estimate, never a measurement.
- **Performance engine** — an empty, labelled slot. The model is not in the repo yet.
- **US ⇄ metric**, light and dark, phone to wall TV.

Everything on it is **sample data**, shaped the way timing gates, GPS, heart rate
and bar speed will arrive. `public/performance/data.js` is the one file to replace
when real feeds are connected. No build step: open the page from any static host.

Seven more venues (tennis, pickleball, squash, padel, football, baseball, track)
are previewed as locked cards. A new surface is one file that calls
`LABP.registerSurface` — the contract is documented at the top of
`public/performance/core.js`.

## Layout

| Path | What's in it |
|---|---|
| `public/index.html` | The decision engine, as a readable page |
| `public/session-builder.html` | Session Builder: 5 / 8 / 13 minute flights |
| `public/performance.html` | Performance dashboard shell |
| `public/performance/core.js`, `core.css` | Dashboard engine: clock, simulation, stage, timeline, design system |
| `public/performance/data.js` | Sample sessions, athletes and plans |
| `public/performance/surface-*.js` | One file per surface: turf, weight room, mat |
| `public/performance/panel-*.js` | Athlete, Stress Bowl, roster, coach actions, charts, next venues |
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
