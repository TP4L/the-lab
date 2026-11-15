/* THE LAB / Performance — sample data.
   Everything here is invented. It is shaped the way real feeds will arrive
   (timing gates, GPS / tracking, heart rate + HRV, bar speed + force), so this
   file is the one thing to replace when real data is connected. */
(function () {
  'use strict';
  var LABP = (window.LABP = window.LABP || {});

  function h(str) {
    var x = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
    x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); x ^= x >>> 15;
    return (x >>> 0) / 4294967296;
  }
  function r2(v) { return Math.round(v * 100) / 100; }

  /* attrs: speed, power, strength, endurance, skill — each 0..1 within the athlete's own age group */
  function athlete(pod, first, last, age, sex, tag, attrs, bowl, note) {
    var id = (first + '-' + last).toLowerCase().replace(/[^a-z-]/g, '');
    var a = attrs || [0, 0, 0, 0, 0].map(function (_, i) { return r2(0.32 + 0.56 * h(id + '|attr' + i)); });
    return {
      id: id, first: first, last: last, age: age, sex: sex, tag: tag, pod: pod,
      attrs: { spd: a[0], pow: a[1], str: a[2], end: a[3], skl: a[4] },
      bowlSeed: bowl || null, note: note || ''
    };
  }

  /* Stress Bowl — total load and readiness framework. A planning metaphor, not a measurement.
     Each source is the coach's estimate of how much of the bowl it is taking up today (0..1 of capacity). */
  var BOWL_SOURCES = [
    { key: 'training', label: 'Training' },
    { key: 'work', label: 'Work', minorLabel: 'School' },
    { key: 'competition', label: 'Competition' },
    { key: 'sleep', label: 'Poor sleep' },
    { key: 'travel', label: 'Travel' },
    { key: 'emotional', label: 'Emotional pressure' },
    { key: 'other', label: 'Other stressors' }
  ];
  function bowlFor(a, pop) {
    var s = a.bowlSeed, out = {};
    var base = { training: 0.2, work: pop === 'exec' ? 0.2 : 0.1, competition: pop === 'hs' ? 0.08 : 0.02, sleep: 0.07, travel: pop === 'exec' ? 0.07 : 0.02, emotional: 0.06, other: 0.02 };
    BOWL_SOURCES.forEach(function (src) {
      var v = base[src.key] * (0.35 + 1.3 * h(a.id + '|bowl|' + src.key));
      if (s && s[src.key] != null) v = s[src.key];
      out[src.key] = Math.round(v * 100) / 100;
    });
    return out;
  }

  var hs = [
    athlete('A', 'Maya', 'Reyes', 16, 'F', 'Soccer', [0.82, 0.70, 0.55, 0.78, 0.74]),
    athlete('A', 'Jalen', 'Okoro', 17, 'M', 'Football', [0.90, 0.88, 0.80, 0.55, 0.62],
      { training: 0.3, work: 0.12, competition: 0.22, sleep: 0.1, travel: 0.02, emotional: 0.06, other: 0 }, 'Game Friday. Keep the bar fast, cut volume.'),
    athlete('A', 'Tessa', 'Lindqvist', 15, 'F', 'Volleyball', [0.58, 0.80, 0.50, 0.60, 0.66]),
    athlete('A', 'Dev', 'Patel', 16, 'M', 'Wrestling', [0.62, 0.66, 0.74, 0.82, 0.88]),
    athlete('B', 'Marcus', 'Bell', 18, 'M', 'Football', [0.74, 0.86, 0.94, 0.48, 0.58]),
    athlete('B', 'Sofia', 'Marin', 17, 'F', 'Track', [0.95, 0.76, 0.52, 0.70, 0.60],
      { training: 0.26, work: 0.1, competition: 0.12, sleep: 0.08, travel: 0.15, emotional: 0.04, other: 0 }, 'Back from an away meet Sunday night.'),
    athlete('B', 'Kai', 'Nakamura', 15, 'M', 'Baseball', [0.66, 0.60, 0.50, 0.58, 0.72]),
    athlete('B', 'Imani', 'Brooks', 16, 'F', 'Basketball', [0.78, 0.84, 0.60, 0.66, 0.70]),
    athlete('C', 'Luca', 'Ferrari', 17, 'M', 'Lacrosse', [0.80, 0.70, 0.68, 0.76, 0.68]),
    athlete('C', 'Noor', 'Haddad', 16, 'F', 'Wrestling', [0.60, 0.62, 0.66, 0.84, 0.90]),
    athlete('C', 'Eli', 'Thompson', 15, 'M', 'Soccer', [0.70, 0.52, 0.42, 0.80, 0.64],
      { training: 0.16, work: 0.22, competition: 0.04, sleep: 0.2, travel: 0, emotional: 0.14, other: 0.02 }, 'Exam week. Short on sleep.'),
    athlete('C', 'Zoe', 'Castillo', 18, 'F', 'Softball', [0.68, 0.78, 0.72, 0.56, 0.70])
  ];

  var kids = [
    athlete('A', 'Milo', 'Grant', 9, 'M', 'Age 9'),
    athlete('A', 'Ava', 'Petrov', 8, 'F', 'Age 8'),
    athlete('A', 'Theo', 'Washington', 10, 'M', 'Age 10'),
    athlete('A', 'Lena', 'Ortiz', 7, 'F', 'Age 7', null, null, 'New this month. Loves the mat, cautious on the turf.'),
    athlete('B', 'Jonah', 'Fischer', 11, 'M', 'Age 11'),
    athlete('B', 'Priya', 'Nair', 9, 'F', 'Age 9'),
    athlete('B', 'Owen', 'Clarke', 8, 'M', 'Age 8'),
    athlete('B', 'Ruby', 'Adeyemi', 10, 'F', 'Age 10'),
    athlete('C', 'Mateo', 'Silva', 10, 'M', 'Age 10'),
    athlete('C', 'Ivy', 'Chen', 9, 'F', 'Age 9'),
    athlete('C', 'Caleb', 'Rosen', 7, 'M', 'Age 7'),
    athlete('C', 'Nia', 'Banks', 11, 'F', 'Age 11')
  ];

  var exec = [
    athlete('A', 'Dana', 'Whitfield', 47, 'F', 'Hybrid racing', [0.62, 0.55, 0.60, 0.78, 0.58],
      { training: 0.14, work: 0.34, competition: 0, sleep: 0.2, travel: 0.2, emotional: 0.08, other: 0 }, 'Quarter close plus two red-eyes this week.'),
    athlete('A', 'Robert', 'Chen', 52, 'M', 'Golf', [0.48, 0.60, 0.58, 0.50, 0.72]),
    athlete('A', 'Priya', 'Raman', 39, 'F', 'Tennis', [0.74, 0.66, 0.52, 0.70, 0.76]),
    athlete('A', 'Tom', 'Gallagher', 61, 'M', 'Longevity', [0.36, 0.40, 0.55, 0.60, 0.50],
      { training: 0.14, work: 0.06, competition: 0, sleep: 0.04, travel: 0, emotional: 0.03, other: 0.02 }, 'Retired in spring. Sleeping well, lots of room.'),
    athlete('B', 'Angela', 'Moore', 44, 'F', 'Marathon', [0.56, 0.44, 0.46, 0.90, 0.52]),
    athlete('B', 'Michael', 'Osei', 36, 'M', 'Back to sport', [0.80, 0.78, 0.74, 0.62, 0.66]),
    athlete('B', 'Karen', 'Novak', 58, 'F', 'Skiing', [0.42, 0.48, 0.50, 0.64, 0.60]),
    athlete('B', 'David', 'Kim', 41, 'M', 'Pickup basketball', [0.66, 0.70, 0.62, 0.54, 0.64]),
    athlete('C', 'Laura', 'Mendez', 49, 'F', 'Pickleball', [0.58, 0.52, 0.48, 0.66, 0.70]),
    athlete('C', 'Steve', 'Hartman', 63, 'M', 'Longevity', [0.30, 0.36, 0.52, 0.46, 0.44]),
    athlete('C', 'Renee', 'Dubois', 35, 'F', 'Trail running', [0.72, 0.60, 0.50, 0.86, 0.58]),
    athlete('C', 'Paul', 'Abernathy', 55, 'M', 'Golf', [0.44, 0.56, 0.64, 0.42, 0.62],
      { training: 0.1, work: 0.3, competition: 0, sleep: 0.16, travel: 0.12, emotional: 0.12, other: 0.04 }, 'Board week. Keep it restorative.')
  ];

  var ROT = { A: ['turf', 'weights', 'mat'], B: ['weights', 'mat', 'turf'], C: ['mat', 'turf', 'weights'] };
  var PODS = [{ id: 'A', name: 'Pod A' }, { id: 'B', name: 'Pod B' }, { id: 'C', name: 'Pod C' }];

  /* Each surface runs the same menu for every pod that rotates onto it. Minutes per surface must total 16. */
  var SESSIONS = [
    {
      id: 'hs', name: 'HS Performance', pop: 'hs', popLabel: 'High school · 15–18', when: '4:45 PM', status: 'live', coach: 'Coach on floor',
      pods: PODS, rotation: ROT, athletes: hs,
      plan: {
        turf: [
          { act: 'sprint', min: 6, title: 'Gated sprints', note: '10, 20 and 40 yd through the timing gates. Full recovery.' },
          { act: 'agility', min: 4, title: '5-10-5 shuttle', note: 'Change of direction, both sides, gate timed.' },
          { act: 'game', min: 6, title: 'Chase & evade', note: 'Tag game. Sprint, cut and reaction numbers captured inside the game.' }
        ],
        weights: [
          { act: 'lift', min: 8, title: 'Main lift', note: 'Trap-bar deadlift and squat. Bar speed sets the load.' },
          { act: 'shock', min: 4, title: 'Shock work', note: 'Depth drops and rebound jumps off the box.' },
          { act: 'iso', min: 4, title: 'Isometric holds', note: 'Max-intent holds against the pins.' }
        ],
        mat: [
          { act: 'discovery', min: 4, title: 'Movement discovery', note: 'Open task. Find three ways across the mat.' },
          { act: 'rough', min: 6, title: 'Roughhousing games', note: 'Sumo, push-pull, king of the mat.' },
          { act: 'wrestle', min: 6, title: 'Live goes', note: 'Structured wrestling in pairs, scored.' }
        ]
      }
    },
    {
      id: 'kids', name: 'Movement Lab', pop: 'kids', popLabel: 'Kids · 6–11', when: '3:30 PM', status: 'complete', coach: 'Coach on floor',
      pods: PODS, rotation: ROT, athletes: kids,
      plan: {
        turf: [
          { act: 'game', min: 6, title: 'Sharks & minnows', note: 'Chase game. Sprint and cut numbers captured inside the game.' },
          { act: 'relay', min: 5, title: 'Head-to-head relays', note: 'Paired races through the gates.' },
          { act: 'agility', min: 5, title: 'Cone maze', note: 'Find the fastest way through.' }
        ],
        weights: [
          { act: 'power', min: 6, title: 'Jumps & throws', note: 'Broad jump, vertical, med-ball throw.' },
          { act: 'iso', min: 4, title: 'Statues', note: 'Holds and hangs. Who can stay still the longest.' },
          { act: 'circuit', min: 6, title: 'Station circuit', note: 'Rotate through the stations.' }
        ],
        mat: [
          { act: 'discovery', min: 6, title: 'Movement discovery', note: 'Animal patterns, rolls, balance challenges.' },
          { act: 'rough', min: 6, title: 'Roughhousing games', note: 'Sumo circles, tug, king of the mat.' },
          { act: 'falling', min: 4, title: 'Falling & landing', note: 'Getting down and back up safely.' }
        ]
      }
    },
    {
      id: 'exec', name: 'Executive Performance', pop: 'exec', popLabel: 'Adults · business professionals', when: '6:15 AM', status: 'complete', coach: 'Coach on floor',
      pods: PODS, rotation: ROT, athletes: exec,
      plan: {
        turf: [
          { act: 'sled', min: 6, title: 'Sleds & carries', note: 'Sled push and pull, loaded carries.' },
          { act: 'tempo', min: 6, title: 'Tempo intervals', note: 'Heart-rate guided runs with full walk-back.' },
          { act: 'agility', min: 4, title: 'Footwork', note: 'Low-amplitude change of direction.' }
        ],
        weights: [
          { act: 'lift', min: 8, title: 'Main lift', note: 'Trap-bar deadlift and squat. Bar speed sets the load.' },
          { act: 'power', min: 3, title: 'Jumps & throws', note: 'Low-volume power: med-ball and box.' },
          { act: 'iso', min: 5, title: 'Isometric holds', note: 'Position holds for tendon and joint.' }
        ],
        mat: [
          { act: 'discovery', min: 6, title: 'Ground flow', note: 'Movement discovery: get down, travel, get up.' },
          { act: 'falling', min: 5, title: 'Falling & getting up', note: 'Safe falls and efficient stand-ups.' },
          { act: 'rough', min: 5, title: 'Partner push-pull', note: 'Controlled roughhousing in pairs.' }
        ]
      }
    }
  ];

  SESSIONS.forEach(function (s) {
    s.athletes.forEach(function (a) {
      a.pop = a.pop || s.pop;
      a.minor = a.age < 18;
      a.name = a.minor ? a.first + ' ' + a.last.charAt(0) + '.' : a.first + ' ' + a.last;
      a.initials = (a.first.charAt(0) + a.last.charAt(0)).toUpperCase();
      a.bowl = bowlFor(a, s.pop);
      var fill = 0; for (var k in a.bowl) fill += a.bowl[k];
      /* supporting signals, loosely tied to how full the bowl is */
      var hrvBase = Math.round((s.pop === 'exec' ? 44 : s.pop === 'kids' ? 78 : 68) + 22 * a.attrs.end - (a.age > 45 ? 8 : 0) + 8 * (h(a.id + '|hrv') - 0.5));
      var hrvToday = Math.round(hrvBase * (1.08 - 0.42 * Math.max(0, fill - 0.35)) + 5 * (h(a.id + '|hrvd') - 0.5));
      var rhrBase = Math.round((s.pop === 'kids' ? 78 : 62) - 12 * a.attrs.end + 5 * (h(a.id + '|rhr') - 0.5));
      a.ready = {
        hrv: hrvToday, hrvBase: hrvBase,
        rhr: rhrBase + Math.round(9 * Math.max(0, fill - 0.4)), rhrBase: rhrBase,
        sleep: Math.round((8.4 - 10 * a.bowl.sleep + 0.6 * (h(a.id + '|slp') - 0.5)) * 10) / 10
      };
    });
  });

  /* One-tap coach observations, per surface. */
  var TAGS = {
    turf: ['Great first step', 'Held top speed', 'Clean cut', 'Smart angle', 'Faded late', 'Needs more rest'],
    weights: ['Fast bar', 'Solid position', 'Stuck the landing', 'Grinder rep', 'Lost position', 'Ready for more'],
    mat: ['Found a new solution', 'Stayed balanced', 'Recovered fast', 'Safe landing', 'Great partner', 'Needs confidence']
  };

  /* Venues that plug into the same framework next. */
  var NEXT = [
    { id: 'tennis', name: 'Tennis court' },
    { id: 'pickleball', name: 'Pickleball court' },
    { id: 'squash', name: 'Squash court' },
    { id: 'padel', name: 'Padel court' },
    { id: 'football', name: 'Football field' },
    { id: 'baseball', name: 'Baseball diamond' },
    { id: 'track', name: 'Track' }
  ];

  LABP.DATA = { sessions: SESSIONS, tags: TAGS, next: NEXT, bowlSources: BOWL_SOURCES };
})();
