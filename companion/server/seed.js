/* Starter content. Loaded once into an empty database.
   Situations 1-4 are the worked examples from .claude/skills/lab-coach/reference/examples.md.
   Drills are starter drills keyed to the seven calls; edit them to your program. */

const SITUATIONS = [
  {
    title: 'Squaring up at the top',
    source: 'Worked example 1',
    positions: ['Defense', 'LSM', 'Midfield'],
    description: 'Ball carrier picks his head up at the top: feet under him, stick up. You’re a step and a half off with no help declared. He beat you from this exact look once already tonight.',
    inputs: { h: 3, t: 2, b: 3, o: 'to', cert: 'low', state: 'N', scr: false, need: 2, debt: false, cover: false, drift: false }
  },
  {
    title: 'Broken slide, two in your area',
    source: 'Worked example 2',
    positions: ['Defense', 'LSM', 'Midfield'],
    description: 'You slid, the ball moved past you, and now two attackers are in your area with nobody clearly assigned. Your legs are gone from the slide.',
    inputs: { h: 0, t: 3, b: 1, o: 'to', cert: 'mod', state: 'D', scr: true, need: 1, debt: true, cover: false, drift: false }
  },
  {
    title: 'Tight defender, stick on your hands',
    source: 'Worked example 3',
    positions: ['Attack', 'Midfield'],
    description: 'You have the ball and you’re balanced. Your defender is even with you and tight, stick on your hands. No shooting window.',
    inputs: { h: 1, t: 1, b: 3, o: 'to', cert: 'high', state: 'O', scr: false, need: 3, debt: false, cover: false, drift: false }
  },
  {
    title: 'Second scramble, no second commit',
    source: 'Worked example 4',
    positions: ['Defense', 'LSM', 'Midfield'],
    description: 'Second scramble in the same possession. You already slid once and recovered late. Ball is moving around the perimeter, no immediate shot, and your unit still isn’t reset.',
    inputs: { h: 1, t: 3, b: 3, o: 'to', cert: 'mod', state: 'D', scr: true, need: 2, debt: true, cover: true, drift: false }
  },
  {
    title: 'Downhill dodger, crease set to rotate',
    source: 'Starter',
    positions: ['Defense', 'LSM'],
    description: 'Dodger beats his man topside and is coming downhill, stick loaded, two steps from a clean look. You’re the adjacent defender, your man is off-ball, and your crease man is set to rotate behind you.',
    inputs: { h: 3, t: 3, b: 3, o: 'to', cert: 'high', state: 'D', scr: false, need: 0, debt: false, cover: true, drift: false }
  },
  {
    title: 'Downhill dodger, nobody behind you',
    source: 'Starter',
    positions: ['Defense', 'LSM'],
    description: 'Same downhill dodger, same loaded stick, but you slid on the last dodge and never got back to your spot. Nobody behind you has called the rotation.',
    inputs: { h: 3, t: 3, b: 3, o: 'to', cert: 'high', state: 'D', scr: false, need: 0, debt: true, cover: false, drift: false }
  },
  {
    title: 'Weak side, eyes on the ball',
    source: 'Starter',
    positions: ['Defense', 'LSM', 'Midfield'],
    description: 'Settled half-field. Your man is off-ball on the weak side. The ball is swinging up top and you’ve been watching it, and the attacker at X has been feeding all night.',
    inputs: { h: 1, t: 3, b: 3, o: 'to', cert: 'mod', state: 'D', scr: false, need: 2, debt: false, cover: true, drift: true }
  },
  {
    title: 'Third time to the strong hand',
    source: 'Starter',
    positions: ['Defense', 'LSM'],
    description: 'You’re on the ball, he’s dodging to his strong hand for the third time tonight and telegraphing it. Your help is set and nobody on your side owes a recovery.',
    inputs: { h: 2, t: 1, b: 2, o: 'to', cert: 'high', state: 'D', scr: false, need: 4, debt: false, cover: true, drift: false }
  },
  {
    title: 'Unknown hand on the wing',
    source: 'Starter',
    positions: ['Defense', 'LSM', 'Midfield'],
    description: 'Ball carrier is walking it along the wing, stick in one hand, looking for a lane. You want to pressure him, but you haven’t seen this player before and you don’t know his hand.',
    inputs: { h: 2, t: 2, b: 3, o: 'to', cert: 'low', state: 'D', scr: false, need: 4, debt: false, cover: true, drift: false }
  },
  {
    title: 'Set offense, no window yet',
    source: 'Starter',
    positions: ['Attack', 'Midfield'],
    description: 'You carry into the attack balanced and square, defender is a step off and playing your hands. Your team is set, spacing is good, but there’s no window yet.',
    inputs: { h: 1, t: 2, b: 3, o: 'to', cert: 'mod', state: 'O', scr: false, need: 4, debt: false, cover: false, drift: false }
  },
  {
    title: 'Knocked down on a loose ball',
    source: 'Starter',
    positions: ['Defense', 'Midfield', 'Attack', 'LSM', 'FOGO'],
    description: 'Loose ball on the ground, both teams scrambling, you just got knocked off your feet and are getting up near the crease. Nobody knows who has whom.',
    inputs: { h: 0, t: 2, b: 0, o: 'away', cert: 'low', state: 'N', scr: true, need: 1, debt: true, cover: false, drift: false }
  },
  {
    title: 'Wing catch, facing the sideline',
    source: 'Starter',
    positions: ['Defense', 'LSM'],
    description: 'Ball carrier catches on the wing facing the sideline, stick low. You’re a step off and your unit is set with nobody in debt. You’re not sure yet whether he’ll roll back or feed.',
    inputs: { h: 1, t: 2, b: 2, o: 'away', cert: 'mod', state: 'D', scr: false, need: 2, debt: false, cover: true, drift: false }
  },
  {
    title: 'Dodging off a short-stick',
    source: 'Starter',
    positions: ['Midfield', 'Attack'],
    description: 'You get the ball up top with a short-stick on you. He’s square but a half step slow on his feet, and he’s been biting on your first move all game. You’re balanced and the alley is open.',
    inputs: { h: 2, t: 1, b: 3, o: 'to', cert: 'high', state: 'O', scr: false, need: 3, debt: false, cover: false, drift: false }
  },
  {
    title: 'Off-ball in a broken clear',
    source: 'Starter',
    positions: ['Midfield', 'Attack'],
    description: 'Your clear breaks down. The ball is loose between the restraining line and the box, two of your teammates are chasing it, and your man is drifting toward the middle.',
    inputs: { h: 0, t: 2, b: 2, o: 'to', cert: 'mod', state: 'N', scr: true, need: 1, debt: false, cover: false, drift: false }
  }
];

const DRILLS = [
  {
    name: 'Go Stay Go approach ladder',
    call: 'gsg', positions: ['Defense', 'LSM', 'Midfield'], players: '2 lines, 1v1', minutes: 10,
    setup: 'Ball carrier starts 15 yards out at the top. Defender starts on the goal line extended. Coach stands behind the defender.',
    steps: 'Coach passes to the ball carrier. Defender runs Go on the approach. Ball carrier holds a look for one beat. Defender must Stay until the carrier declares, then Go. Carrier plays live for 5 seconds.',
    points: 'The Stay is information, not a stop. Feet stay live on the Stay. If the defender commits before the declare, the rep restarts.'
  },
  {
    name: 'Declare or hold',
    call: 'gsg', positions: ['Defense', 'LSM'], players: '1v1 + coach', minutes: 8,
    setup: 'Ball carrier at the top of the box, defender a step and a half off.',
    steps: 'Coach signals the carrier from behind the defender: real dodge, fake, or hold. Defender must match. A commit on a fake is a lost rep.',
    points: 'Low Certainty caps commitment. Say "Stay" out loud on every hold.'
  },
  {
    name: 'Cover Cover Sit shell',
    call: 'ccs', positions: ['Defense', 'LSM'], players: '4v3 shell', minutes: 12,
    setup: 'Four offensive players around the perimeter, three defenders in a triangle.',
    steps: 'Ball moves around the perimeter. Defenders rotate on each pass: cover, cover, then sit on the third pass instead of jumping it. Coach adds a fourth defender after 60 seconds to simulate a reset.',
    points: 'Sit is the refusal to borrow. The goal is getting the unit reset, not getting the ball back.'
  },
  {
    name: 'Oh Slide Go with a live crease',
    call: 'osg', positions: ['Defense', 'LSM'], players: '3v3 + dodger', minutes: 12,
    setup: 'Dodger at the top against his defender. Adjacent defender and crease defender set. Two offensive off-ball players.',
    steps: 'Dodger beats his man. Adjacent slides only after the crease defender calls the rotation. If the crease is silent, adjacent holds and the on-ball recovers.',
    points: 'Oh Slide Go is only legal when Cover can be filled. No call from the crease, no slide.'
  },
  {
    name: 'Hip pocket ride',
    call: 'hpo', positions: ['Defense', 'LSM'], players: '1v1 alley', minutes: 10,
    setup: 'Ball carrier dodges down the alley from the wing. Defender starts on his hip.',
    steps: 'Tell the defender the dodger’s strong hand before each rep. Defender rides in the hip pocket, then takes the over-top position to cut the finish.',
    points: 'Position, not effort. The drill only runs with a known hand; Hip Pocket Over is a high-Certainty call.'
  },
  {
    name: 'X call half-field',
    call: 'x', positions: ['Defense', 'LSM', 'Midfield'], players: '6v6 half-field', minutes: 15,
    setup: 'Full offensive set with a feeder at X.',
    steps: 'Offense moves the ball. On every swing, off-ball defenders call "X" and point before they look at the ball. Coach whistles randomly and asks one defender where the X is.',
    points: 'The X stays in your accounting when the ball is elsewhere. A backdoor cut that "came out of nowhere" is a missed X.'
  },
  {
    name: 'Triangle 1v1 from the top',
    call: 'tri', positions: ['Attack', 'Midfield'], players: '1v1', minutes: 10,
    setup: 'Dodger up top with a tight defender playing the hands.',
    steps: 'Speedup: two hard steps to force a reaction. Counter: change direction off the reaction. Exit: take the angle the defender vacated and shoot or feed.',
    points: 'Three beats as one unit. Only run it balanced; the speedup spends Balance.'
  },
  {
    name: 'Scramble box ground balls',
    call: 'own', positions: ['Defense', 'Midfield', 'Attack', 'LSM', 'FOGO'], players: '3v3 in a 15-yard box', minutes: 8,
    setup: 'Coach rolls a ground ball into the box.',
    steps: 'Play live until possession, then keep playing keep-away. Defenders are scored on holding the space between the ball and the goal cone, not on chasing.',
    points: 'Own space not lines. Space is cheap to hold and expensive to chase.'
  },
  {
    name: 'Slide and recover conditioning',
    call: 'ccs', positions: ['Defense', 'LSM', 'Midfield'], players: 'Unit of 3-6', minutes: 8,
    setup: 'Defensive unit in a set.',
    steps: 'Coach points: slider goes, recovers to his spot, and calls "Debt paid". No second slide is allowed until that call. Run 6 reps in a row.',
    points: 'Every commit borrows. The next commit is only legal after the debt is paid.'
  },
  {
    name: 'Pipeline freeze',
    call: '', positions: ['Defense', 'Midfield', 'Attack', 'LSM', 'Goalie', 'FOGO'], players: '6v6', minutes: 15,
    setup: 'Live 6v6 half-field.',
    steps: 'Coach blows a freeze whistle mid-possession. One player per side says their Read (H/T/B), State + Need, and the call out loud. Resume from the freeze.',
    points: 'Name the rung out loud. Rung-skipping is the most common error in the model.'
  }
];

const PLAN = {
  title: 'Defensive install: approach and slide',
  date: null,
  notes: 'Example plan. Edit or delete it.',
  items: [
    { drill: 'Go Stay Go approach ladder', minutes: 10 },
    { drill: 'Oh Slide Go with a live crease', minutes: 12 },
    { drill: 'Cover Cover Sit shell', minutes: 12 },
    { drill: 'Pipeline freeze', minutes: 15 }
  ]
};

/* Demo roster. Marked demo=1 so the app can label them and clear them in one step. */
const DEMO_PLAYERS = [
  { name: 'Jordan Reyes', number: '21', position: 'Defense', level: 'Varsity', notes: 'Strong on-ball. Slides early.' },
  { name: 'Sam Okafor', number: '7', position: 'Midfield', level: 'Varsity', notes: 'Two-way middie.' },
  { name: 'Casey Lin', number: '14', position: 'Attack', level: 'JV', notes: '' }
];
const DEMO_REPS = [
  { player: 0, note: 'Slid off the wing before the dodger declared. Ball swung behind for a layup.', call: 'osg', error: 'need' },
  { player: 0, note: 'Two of us sat on the same man and the crease was open.', call: 'ccs', error: 'org' },
  { player: 0, note: 'Watched the ball up top, their X cut backdoor.', call: 'x', error: 'see' },
  { player: 1, note: 'Right approach, tripped on the recover step.', call: 'gsg', error: 'exec' },
  { player: 2, note: 'Ran the Triangle with no balance after a check.', call: 'tri', error: 'need' }
];

module.exports = { SITUATIONS, DRILLS, PLAN, DEMO_PLAYERS, DEMO_REPS };
