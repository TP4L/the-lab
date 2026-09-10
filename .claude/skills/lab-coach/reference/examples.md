# Worked Examples

Each example shows the full internal pipeline run, then the four-part output.
**Only the four-part output is delivered.** The pipeline trace is here to show
the reasoning that produces it.

---

## 1. Low certainty, ball carrier squaring up

**Situation:** Ball carrier has picked up his head at the top, feet under him,
stick up. You are a step and a half off. You have no help declared yet and you
have already been beaten once from this look tonight.

<details><summary>Pipeline trace</summary>

- **Context:** beaten once from this exact look — the price of a second miss is high.
- **See:** head up, feet under him, stick up, no help declared.
- **Read:** Height high (stick up). Time moderate — a step and a half is real
  cushion but shrinking. Balance high, feet under him. Orientation square to
  goal. **Certainty low** — Pattern Memory says he showed this once already and
  may be selling it.
- **State:** Neutral. He hasn't dictated yet; the next beat decides.
- **Need:** Stabilize — nothing to survive this instant, but structure is thin
  with no help declared.
- **Solve:** Committing costs the cushion, and low Certainty makes commitment
  illegal. Target: **Time** — make him declare before I spend anything.
- **Predict:** he reads the approach and takes the first step he was already
  planning.
- **Organize:** I have Move. Help is unassigned — flag it.

</details>

**Output:**

1. **Read** — Height high, stick up and loaded. Time moderate, a step and a half
   of cushion and closing. Balance high, feet under him. Orientation square.
   Certainty low: he showed this look once already tonight.
2. **State + Need** — Neutral. Need: Stabilize.
3. **Action** — **Go Stay Go**.
4. **Why** — Low Certainty makes a commit illegal, so the Stay beat buys the
   information before I spend the cushion.

---

## 2. Broken structure after a commit

**Situation:** You slid, the ball moved past you, and now two attackers are in
your area with nobody clearly assigned. Your legs are gone from the slide.

<details><summary>Pipeline trace</summary>

- **Read:** ball off-stick, so Height is momentarily zero on the carrier — but
  Time is high for the receiver and my own Balance is low. The dangerous factor
  is the space behind me, not the current shot.
- **State:** Defensive / **Scramble** — the map is stale, assignments are gone.
- **Need:** Recover. The slide borrowed and the debt is unpaid; I am not legal
  for another commit.
- **Solve:** any chase is high Cost and low Target. Zero the cheapest factor:
  hold the area that both attackers must use.
- **Organize:** I take Recover, not Move. Someone else has Move.

</details>

**Output:**

1. **Read** — Height zero on the ball right now, it's in transit. Time high for
   whoever receives. My Balance low — the slide spent it. Certainty moderate;
   two live options, neither declared.
2. **State + Need** — Defensive / Scramble. Need: Recover.
3. **Action** — **Own space not lines**.
4. **Why** — I'm in Recovery Debt, so chasing a line costs legs I don't have and
   holding the area they both need costs nothing.

---

## 3. Advantage in hand, needs one more factor

**Situation:** You have the ball, balanced, defender is even with you but tight.
No shooting window — his stick is on your hands.

<details><summary>Pipeline trace</summary>

- **Read:** my Balance high. Height suppressed — his stick is on my hands.
  Time low, he's tight. Orientation good. Certainty high, he's committed to
  pressuring the hands.
- **State:** Offensive — I hold the ball and the initiative.
- **Need:** Build. There is nothing to finish yet; I'm short a factor.
- **Solve:** Height is the zero. I can't raise it against a tight stick, so I
  have to make him move it. Target: force the reaction, take the vacated angle.
- **Predict:** he reacts to the speedup by shifting his stick and hips to cut off
  the first move.

</details>

**Output:**

1. **Read** — Height suppressed, his stick is on my hands. Time low, he's tight.
   Balance high, I'm under myself. Orientation good. Certainty high — he's
   committed to the hands.
2. **State + Need** — Offensive. Need: Build.
3. **Action** — **The Triangle**: speedup → counter → exit.
4. **Why** — Height is my zero and he won't give it up standing still, so I make
   him move the stick and take the angle he vacates.

---

## 4. Cannot afford another commit

**Situation:** Second scramble in the same possession. You've already slid once
and recovered late. Ball is moving around the perimeter, no immediate shot, but
your unit is still not reset.

<details><summary>Pipeline trace</summary>

- **Read:** Height low on the perimeter, Time high for them, Balance high for
  them. No shot right now — the product is near zero only because of Height, and
  Height is one pass from changing.
- **State:** Defensive / Scramble — still not reset.
- **Need:** Stabilize. Survive is satisfied; nothing is imminent.
- **Solve:** the tempting call is to jump the pass. Cost analysis kills it — a
  second unpaid debt turns a stable Scramble into a shot. Target: buy reset time.
- **Organize:** everyone takes Cover, nobody takes Move.

</details>

**Output:**

1. **Read** — Height low, ball on the perimeter. Time high for them, no pressure
   applied. Balance high for them. Certainty moderate — no one has declared.
2. **State + Need** — Defensive / Scramble. Need: Stabilize.
3. **Action** — **Cover Cover Sit**.
4. **Why** — I've already got one unpaid debt this possession; the Sit refuses
   to borrow a second and buys the unit its reset.
