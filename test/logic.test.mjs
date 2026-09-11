/* Scoring, ranking, the champion rule and undo — the pure logic inside the
   page, run without a browser. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(root, 'site/race-to-50.html'), 'utf8');
const src = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));

const noop = () => {};
const el = () => ({ innerHTML:'', textContent:'', className:'', hidden:true, dataset:{},
  classList:{toggle:noop,add:noop,remove:noop}, addEventListener:noop, focus:noop,
  getContext:()=>({scale:noop,clearRect:noop,save:noop,restore:noop,translate:noop,
    rotate:noop,fillRect:noop}), clientWidth:300, clientHeight:300, style:{} });
const store = {};
const ctx = {
  console,
  document: { getElementById: el, querySelector: el, querySelectorAll: () => [],
    addEventListener: noop, body: el() },
  window: { matchMedia: () => ({ matches:false }), addEventListener: noop, scrollTo: noop },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k,v)=>{store[k]=v;}, },
  location: { hash:'', pathname:'/x', search:'' },
  history: { replaceState: noop },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: noop, cancelAnimationFrame: noop,
  // No hosted scoreboard in this harness — the page must fall back cleanly.
  fetch: () => Promise.reject(new Error('offline')),
  TextEncoder, Date, Math, navigator: {},
};
ctx.window.claude = undefined;
vm.createContext(ctx);
vm.runInContext(src, ctx);

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fails++; console.log(`FAIL ${name}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
};

// ── build an event: 8 players, doubles, rally scoring ──
ctx.store.meta = { target: 50, maxPlayers: 8 };
ctx.store.players = {};
[1,2,3,4,5,6,7,8].forEach(n => { ctx.store.players[n] = { num:n, name:'P'+n, device:'', joinedAt:1 }; });
ctx.store.games = {};
let t = 1000;
const game = (s1, s2, p1, p2) => { const id='g'+(t); ctx.store.games[id] = {id,s1,s2,p1,p2,at:t}; t+=1000; };

game([1,2],[3,4], 11, 8);    // 1,2 -> 11 ; 3,4 -> 8
game([1,3],[2,4], 9, 11);    // 1 ->20, 3 ->17 ; 2 ->22, 4 ->19
game([1,4],[2,3], 11, 6);    // 1 ->31, 4 ->30 ; 2 ->28, 3 ->23

let st = ctx.standings();
const pts = Object.fromEntries(st.rows.map(r => [r.num, r.points]));
check('totals credit every player on a side', pts, {1:31,2:28,3:23,4:30,5:0,6:0,7:0,8:0});
check('games played counted', st.rows.find(r=>r.num===1).games, 3);
check('no champion yet', st.champs, []);
check('rank order: points desc', st.rows.slice(0,4).map(r=>r.num), [1,4,2,3]);
check('to go', st.rows.find(r=>r.num===1).toGo, 19);

// tie on points -> fewer games ranks higher
ctx.store.games = {}; t = 1000;
game([5],[6], 10, 10);
game([5],[7], 10, 0);
game([6],[8], 0, 10);
game([6],[7], 10, 0);
st = ctx.standings();
check('tie broken by fewer games', st.rows.slice(0,2).map(r=>r.num), [5,6]);

// champion: first crossing wins, later bigger totals do not steal it
ctx.store.games = {}; t = 1000;
game([1],[2], 45, 40);
game([1],[3], 5, 49);   // 1 -> 50 exactly, crosses here
game([2],[4], 30, 0);   // 2 -> 70 afterwards
st = ctx.standings();
check('champion is the first to cross', st.champs, [1]);
check('champion timestamp is that game', st.champAt, 2000);
check('later higher total does not steal it', st.rows[0].num, 2);
check('crossing player marked done', st.rows.find(r=>r.num===1).done, true);

// co-champions: partners crossing in the same game
ctx.store.games = {}; t = 1000;
game([1,2],[3,4], 45, 45);
game([1,2],[3,4], 6, 0);   // 1 and 2 both reach 51 in the same game
st = ctx.standings();
check('co-champions both listed', st.champs, [1,2]);

// undo removes the crossing
delete ctx.store.games['g2000'];
st = ctx.standings();
check('undo un-crowns the champion', st.champs, []);
check('undo restores totals', st.rows.find(r=>r.num===1).points, 45);

// walk-up player scored on without checking in still appears
ctx.store.players = {}; ctx.store.games = {}; t = 1000;
game([9],[10], 11, 5);
st = ctx.standings();
check('uncheckedin players appear', st.rows.map(r=>[r.num,r.points,r.checkedIn]), [[9,11,false],[10,5,false]]);

// payload parsing
check('parse deep link', ctx.parsePayload('https://x.test/a#add=17'), 17);
check('parse #p= form',  ctx.parsePayload('#p=3'), 3);
check('parse token',     ctx.parsePayload('LAB50-P12'), 12);
check('parse bare num',  ctx.parsePayload('7'), 7);
check('parse junk',      ctx.parsePayload('https://x.test/'), null);

// QR still encodes a realistic deep link from inside the page
const q = ctx.QR.encode('https://claude.ai/public/artifacts/1234abcd-5678-90ef#add=18', 'M');
check('QR encodes a deep link', q.size > 20 && q.size <= 57, true);

console.log(fails ? `\n${fails} FAILED` : '\nall logic checks passed');
process.exit(fails ? 1 : 0);
