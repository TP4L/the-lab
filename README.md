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

## A note on the vocabulary file

`vocabulary.md` records **when each call is legal** — which Read, State, and Need
rung it belongs to. Where a note reads as a mechanical gloss of the call itself,
it's an inference from the framework's structure, not doctrine. Correct those in
place; the calls and the situations they fit are the durable part.
