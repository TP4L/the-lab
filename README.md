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

## THE LAB Studio

`public/graphics.html` is the studio. Three tabs:

- **Create** — describe a lesson; Claude writes finished LAB sheets in THE LAB's
  code words, zones and decision-engine vocabulary (`public/graphics/knowledge.js`,
  generated from the coach skill by `tools/build-knowledge.py`). Pick a format or
  a full lesson pack, then "Make 3 variations" on any result, as often as you like.
  AI writing runs when the studio is opened from its claude.ai link.
- **Custom Lab** — a free-form board you arrange by hand: drag players,
  opponents, numbered steps, ball paths and movement arrows (bend them with the
  middle handle), paint zones, add headlines, text, panels, extra courts, images.
  Snap to zones, layers with lock/hide, undo/redo, PNG export. Any generated or
  edited sheet opens here with its court rebuilt as movable pieces.
- **Library** — everything you save, searchable. On the claude.ai link it is
  stored in the page's database; elsewhere in this browser.
- **Editor** — change any word or court line by hand, download a PNG
  (standard, 2× or print 3×), save back to the library.

`tools/build-artifact.py` bundles the page into one file for the claude.ai link.

Layouts: numbered list poster · court grid / zone map · pattern playbook card ·
team shape sheet · pressure / escapes · language codebook. Each one ships with a
preset built from the existing LAB sheets (`public/graphics/presets.js` — copy a
block to add your own).

Court diagrams use a small text language on the 9-zone grid
(`O` = opponent side, `Y` = your side):

```
P1 Y1            your player          D1 O3           opponent
ball Y1 > O7 1   ball path + step     ball Y2 ~> O1   arced ball
move Y1 > Y5 2   player movement      zone O7 O8      highlight zones
O7-8 = seam      Y7^ = at the net     Y1_ = at the baseline
```

| Path | What's in it |
|---|---|
| `public/graphics/engine.js` | Canvas drawing: text fitting, brand mark, court, arrows, diagram language |
| `public/graphics/templates.js` | The six layouts and the court-logic table |
| `public/graphics/presets.js` | Starting content for each layout |
| `public/graphics/app.js` | Editor: form, themes, preview, export, save/open |
| `public/graphics/studio.js` | AI writer, variations, library |
| `public/graphics/custom.js` | Custom Lab drag-and-drop board |

## Layout

| Path | What's in it |
|---|---|
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
