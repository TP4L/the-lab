# THE LAB API

One backend for trainwiththelab.com and THE LAB app. The website and the app
use the same accounts, athlete records, sessions and posts through these
endpoints, so there is only one copy of each record.

- Base path: `/api`. Requests and responses are JSON unless noted.
- **Auth:** `POST /api/auth/login` sets an `HttpOnly` session cookie
  (`lab_session`, 30 days). Non-browser clients can send the same token as
  `Authorization: Bearer <token>`.
- **Writes** must send `Content-Type: application/json`. A write carrying a
  foreign `Origin` header is refused (403).
- **Errors** look like `{ "error": "Human-readable message" }`. Status codes:
  400 validation, 401 not signed in, 403 role missing, 404 not found *or not
  yours*, 409 conflict, 413 too large, 415 wrong type, 429 rate limited.
- **Private records answer 404, not 403,** so IDs can't be probed.

## Roles

| Role | Can |
|---|---|
| `athlete` | Everyone. Own profile, shared notes, own results, reflections. |
| `coach` | Athletes they're assigned to: create, notes (private or shared), media, sessions. |
| `contributor` | Write posts, upload post media, submit for review. |
| `editor` | Review, edit any post (including live ones), publish, schedule, unpublish. |
| `admin` | Everything, plus granting roles and issuing password-reset links. |

Sign-up always creates an `athlete`. The account whose email matches
`ADMIN_EMAIL` becomes the first admin. After that, only admins grant roles.

## Accounts

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/signup` | `{name, email, password}` (10+ chars). Signs in. |
| POST | `/auth/login` | `{email, password}`. 10 tries per 15 min per IP and email. |
| POST | `/auth/logout` | |
| GET | `/me` | `{user:{id,email,name,roles}, athlete_id}` |
| PUT | `/me` | `{name}` |
| POST | `/me/password` | `{current, password}`. Signs out other devices. |
| POST | `/me/delete` | `{password}`. See *Account deletion*. |
| POST | `/auth/reset/request` | `{email}`. Always 202. The link goes to the email hook. |
| POST | `/auth/reset/confirm` | `{token, password}`. Single use, 1 hour. Signs out everywhere, then signs in. |

**Account deletion** removes the login, sessions, the athlete's reflections and
the media they uploaded. A profile a coach created stays with the coach,
unlinked, so the coach's session records survive. A self-made profile with no
coach is deleted.

## Athletes and profile claiming

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/athletes?q=` | coach | Roster (admins see everyone). |
| POST | `/athletes` | coach | `{name, hand, side, rating, goals, focus, plan, claim_email?}`. Returns `claim_code` **once**. |
| GET | `/athletes/:id` | coach, self | `{athlete, access, notes, media, results, coaches}`. The athlete gets shared notes and shared media only. |
| PUT | `/athletes/:id` | coach, self | The athlete can edit `hand, side, rating, goals, name`. Only coaches can edit `focus` and `plan`. |
| PUT | `/athletes/:id/photo` | coach, self | `{media_id}` of an image uploaded to this athlete. |
| POST | `/athletes/:id/claim-code` | coach | New code, which invalidates the old one. `{claim_email?}` |
| POST | `/athletes/:id/coaches` | coach | `{email}` of another coach account. |
| POST | `/claim` | signed in | `{code}`. Links the existing record to this account. Single use, rate limited. Enforces `claim_email` if one was set. |
| POST | `/me/athlete` | signed in | Self-made profile, for athletes without a coach. |

`hand`: `right` or `left`. `side`: `left`, `right` or `either`.

## Notes

| Method | Path | Notes |
|---|---|---|
| POST | `/athletes/:id/notes` | `{body, visibility, client_id?, media_id?, session_id?}` |
| PUT | `/notes/:id` | Author only. |
| DELETE | `/notes/:id` | Author only. |

- A coach's note has `kind: "coach"` and `visibility` of `private` (coaches
  only) or `shared` (the athlete sees it).
- An athlete's note is always `kind: "reflection"` with `visibility: "shared"`.
- `client_id` (a UUID) makes retries idempotent: sending the same one twice
  returns the first note.

## Media

`POST /media?athlete_id=N&visibility=private|shared` or `POST /media?post_id=N`

- The body is the raw file. `Content-Type` must be an image
  (jpeg/png/webp/gif/heic) or a video (mp4/quicktime/webm). Max 200 MB.
- Send an `X-Upload-Id: <uuid>` header so a retried upload returns the same
  record instead of a duplicate.
- `GET /media/:id` checks access on every request and supports `Range` (iOS
  needs this for video).
- Athlete media is visible to their coaches, and to the athlete when shared.
  Post media is public once the post is live.

## Training sessions (Scoreboard Studio)

The device creates the session's `id` (a UUID), so a session can start offline.
Scores are an append-only event log. Undo is itself an event pointing at the
event it cancels. Replaying the log in any order gives the same totals, so
several devices, or a device resending after a dropped connection, merge
without conflicts.

| Method | Path | Notes |
|---|---|---|
| GET | `/training/sessions` | Sessions I coach or appear in. |
| POST | `/training/sessions` | `{id, title, athletes:[ids ≤8], items:[{name, measure, target, instructions} ×1–10], started_at}`. Sending it again returns the existing session. |
| GET | `/training/sessions/:id` | `{…, items, athletes, events, summary}`. An athlete sees only their own row. |
| PUT | `/training/sessions/:id` | `{version, title?, items?, status?}`. A stale version returns **409** with `current`. Drills can be renamed or added, not removed. |
| DELETE | `/training/sessions/:id` | Coach. |
| POST | `/training/sessions/:id/events` | `{events:[{id, item_idx, athlete_id, kind, value?, undoes?, at}]}` (≤500). Returns `{stored, duplicates, summary}`. |
| GET | `/athletes/:id/results` | Every session result for one athlete. |

- `measure` is one of `reps` (make/miss), `score`, `time` (seconds) or
  `feel` (1–5).
- `kind` is one of `make`, `miss`, `value` or `undo`.
- An undo event carries the `athlete_id` of the event it cancels.

## Publishing

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/studio/posts?status=` | contributor, editor | Contributors see only their own posts. |
| POST | `/studio/posts` | contributor | `{lane, title, summary, body, tags[], author_credit}` |
| GET | `/studio/posts/:id` | author, editor | Includes `media`. |
| PUT | `/studio/posts/:id` | author (draft, in review), editor (any) | Needs `version`. A stale version returns **409** with `current`. Every save stores a revision. |
| POST | `/studio/posts/:id/submit` | author | draft → in_review |
| POST | `/studio/posts/:id/return` | editor | `{note}`, in_review → draft |
| POST | `/studio/posts/:id/publish` | editor | `{publish_at?}`. A future time schedules the post; otherwise it publishes now. |
| POST | `/studio/posts/:id/unpublish` | editor | → draft |
| GET | `/studio/posts/:id/revisions` | author, editor | |
| DELETE | `/studio/posts/:id` | author (never published), editor | |

- `lane` is one of `quick_read`, `the_work` or `field_study`.
- `body` is plain text, with blank lines between paragraphs. Render it as
  text, never as HTML.

### Public feed (the website reads this)

| Method | Path | Notes |
|---|---|---|
| GET | `/posts?lane=&tag=&limit=` | Live posts, newest first. |
| GET | `/posts/:slug` | One live post with its `media`. |

A scheduled post goes live at its `publish_at` with no job runner needed.
Editorial fields (`review_note`, `version`, author id) are never exposed on
the public endpoints.

## Matches

The device creates the match `id` (a UUID), so a match can be recorded
offline.

| Method | Path | Notes |
|---|---|---|
| POST | `/matches` | See the fields below. |
| GET | `/matches?athlete_id=` | One athlete's history (your own by default), with `result` W/L from their side. |
| GET | `/matches/:id` | Includes `log` (the correction history) and `you.{team, can_confirm, can_verify, can_edit}`. |
| PUT | `/matches/:id` | Correction: the same fields plus `version` and `reason` (required once scored). The old version goes into the log, and status goes back to self-recorded unless an organizer edits. |
| POST | `/matches/:id/confirm` | A player on the other team from the recorder. |
| POST | `/matches/:id/dispute` | `{note}`. A player in the match. |
| POST | `/matches/:id/verify` | The event organizer, a coach of any player, or an admin. |
| DELETE | `/matches/:id` | The recorder while self-recorded, or a verifier. Not for event matches. |

**`POST /matches` fields:**
- `kind`: `casual`, `training` or `competition`
- `game_to`: 5–30
- `win_by`: 1 or 2
- `best_of`: 1, 3 or 5
- `teams`: two lists of one player each (singles) or two each (doubles)
- `games`: a list of `[team1, team2]` scores
- also `played_at`, `note`, `confirm_duplicate`

Each player is one of `{athlete_id}` (yourself, or someone you coach),
`{player_id: "LAB-00012"}` or `{guest_name}`, plus an optional `side` of
`left` or `right`.

**Rules:**
- You can record matches you played in, or for athletes you coach.
- A game can't be tied, and the match must have a winner.
- A match with the same players and scores within 12 hours returns **409**
  with `duplicate_of`, unless `confirm_duplicate` is sent.

**Status** is one of `scheduled`, `recorded` (self-recorded), `confirmed`
(opponent-confirmed), `verified` (organizer-verified) or `disputed`. A coach
recording a match for athletes they coach, without playing in it, is
verified at once.

## Events, check-in, rounds

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/events` | signed in | Published events, plus your drafts. Includes `my_state` and `mode_label`. Never includes share links. |
| POST | `/events` | coach | See **Event settings** below. |
| GET | `/events/:id` | signed in | `me` (number, state, check-in, break), `counts`, `people`, `rounds` (live matches with `acks`), `standings`, `race`, `teams`, `team_standings`, `bracket`. Organizers also get `links {share, watch}`, contact details, player links for guests, `alerts` per player, `undo` and, for Pre-Mapped Doubles, `schedule`. |
| PUT | `/events/:id` | organizer | Any setting. `mode` can't change once matches exist. `status: "cancelled"` notifies everyone signed up. |
| POST | `/events/:id/duplicate` | organizer | `{weeks: 1-8}`. Weekly drafts with the same format; no players or results. |
| POST | `/events/:id/links` | organizer | `{reset: "share"\|"watch"}`. The old link stops working; registered players keep their own links. |
| POST | `/events/:id/register` | athlete | Goes to `waitlist` when full. Refused (409) when registration is closed. |
| POST | `/events/:id/interest` | athlete | |
| POST | `/events/:id/withdraw` | athlete | Moves the first waitlisted player in, and notifies them. |
| POST | `/events/:id/me` | athlete | `{action: break\|back\|leave}`. Leaving frees the spot for the waitlist. |
| POST | `/events/:id/checkin` | organizer | `{code}` (a QR payload `THELAB:…`, the 10-character code, or a player ID) or `{athlete_id}`. |
| POST | `/events/:id/walkin` | organizer | `{name, email?, phone?, checked_in?}`. A player without an account; returns their player `link`. |
| PUT | `/events/:id/people/:aid` | organizer | `{checked_in}`, `{active}`, `{on_break}`, or `{state: registered\|waitlist\|withdrawn}`. |
| POST | `/events/:id/attendance/undo` | organizer | Undoes the latest roster change. Refused once a round has started after it. |
| GET | `/events/:id/rounds/preview?seed=` | organizer | The next round without saving it: courts, sides, head starts, who rests, `seed`. |
| POST | `/events/:id/rounds` | organizer | `{seed?, force?}`. Send the preview's `seed` to start exactly that round. |
| POST | `/events/:id/timer` | organizer | `{round, running}`: start, stop (pause) or resume the current round's timer. The round number must be the current round. |
| POST | `/events/:id/timer/adjust` | organizer | `{round, operation: add\|reset}`. Add keeps the timer running or paused; after time is up it stays paused. Reset restores the round's own length, paused. Ended rounds are refused. |
| POST | `/events/:id/courts` | organizer | `{numbers: [4, 5, 6]}`: the courts for future rounds. Current matches keep theirs. Locked once 3v3 or Fallout starts. |
| GET | `/events/:id/bracket/preview?seeding=&size=` | organizer | The full bracket before it's created: byes, losers side and finals. Saved as the draw; `POST /events/:id/bracket {}` starts from it. |
| POST | `/events/:id/stop` | organizer | Stops every court in the live round: players enter the score as it stands, ties allowed. |
| POST | `/events/:id/schedule` | organizer | Pre-Mapped Doubles: plans every round now (from sign-ups if nobody has checked in). |
| POST | `/matches/:id/reopen` | organizer | Back to unscored so the score can be entered again. |
| POST | `/matches/:id/ack` | player | "Got it": the player has seen their court. |
| POST | `/me/link-guest` | signed in | `{token}` (a player link or its token). Moves a link registration, its courts and results into the account. |
| GET | `/me/checkin` | athlete | `{player_id, code, qr}` for the player card QR. |

**Event settings:**

| Field | Values |
|---|---|
| `mode` | `rotate` (Round Robin), `race` (Race to), `premapped` (Pre-Mapped Doubles), `unlucky`, `rivalry`, `fixed` (Fixed Partners), `draft3` (3v3 Team Draft), `fallout` |
| `courts` | 1–40 |
| `capacity` | 2–500, or none |
| `scoring`, `game_to` | `traditional` (default 11) or `rally` (default 21); 5–30 |
| `round_end` | `all` (every court finishes), `timer` (needs `round_minutes`), `first` (the first finished court stops the round) |
| `round_minutes` | 1–60: rounds get `ends_at` |
| `round_limit` | 2–24 |
| `race_target` | 11–200 (Race to; default 50) |
| `elimination` | `single` or `double` (Fallout; double takes up to 8 teams) |
| `registration_open`, `show_roster`, `late_join` | true or false. `late_join`: rotating formats stay open after play starts; late sign-ups are checked in for the next round. 3v3 and Fallout always lock. |
| `court_numbers` | The actual courts, e.g. `[4, 5]` (1–40). Older events number from 1 up to `courts`. |
| `status` | `draft`, `published`, `live`, `complete`, `cancelled` |

**How rounds are built.** One round at a time, from players who are checked
in, playing and not on a break, so late arrivals, breaks and departures take
effect next round.
- Players with the fewest games go first, then those who have rested most.
- Groupings avoid repeat partners and, except in Rivalry, repeat opponents.
  Rivalry rewards meeting the same opponents again.
- Unlucky gives each team a head start of 0, 3 or 6 (`start1`, `start2` on
  the match). Scores can't be lower than the head start.
- Race to ends the event when a round finishes with someone at the target.
- Pre-Mapped Doubles follows the saved schedule. If the players present don't
  match the next planned round, the rounds still to come are rebuilt.
- 3v3 Team Draft puts two teams of three on a court for three games
  (same `matchup`); winning two takes the matchup.
- Starting a round while the current one has unscored matches returns
  **409** unless you send `force`.
- Players enter scores with `PUT /matches/:id {version, games}`; the
  organizer confirms with `POST /matches/:id/verify`.

The engine aims for fairness; it doesn't guarantee a mathematically perfect
schedule.

**Previews and the saved draw.** `GET /rounds/preview` (and the bracket
preview) saves the draw. `POST /rounds` without a `seed` starts exactly that
draw. Any roster, team, court or settings change marks it stale; starting
then returns **409** with `stale_preview: true` until the host previews
again. For Pre-Mapped Doubles the preview includes every planned round.
Previewing never starts the timer.

**Timers.** Each timed round starts paused (`timer {duration, remaining,
running, ends_at, started}` on the round). Changing `round_minutes` affects
upcoming rounds only; each round keeps its own length.

**Fairness.** Organizers get `fairness`: per confirmed player, `now`
(playing, resting, waiting, on break, left), `games`, `rests`,
`longest_rest` and `repeated_partners`, from completed rounds only. Time
before arriving and breaks aren't rests.

### Public links (no account)

| Method | Path | Notes |
|---|---|---|
| GET | `/public/events/:shareToken` | The sign-up page: details, counts, who's coming (if shown), live courts and standings, `registration {open, full}`. Drafts return 404. |
| POST | `/public/events/:shareToken/register` | `{name, email, phone?}` returns `{token, number, state}`. A signed-in athlete registers with their account instead. One sign-up per email per event. Emails the player link when email is set up. |
| GET | `/watch/:watchToken` | Spectators: courts, standings, bracket, results. No contact details. |
| GET | `/g/:playerToken` | A guest's player page: the event plus `me` and `guest {name, number, player_id, qr, linked, alerts}`. |
| POST | `/g/:playerToken/score` | `{match_id, games, version?}` for their own match, until the organizer confirms it. |
| POST | `/g/:playerToken/ack` | `{match_id}` |
| POST | `/g/:playerToken/status` | `{action: break\|back\|leave}` |
| POST | `/g/:playerToken/push` | A Web Push subscription for court alerts; `{test: true}` sends a test. `/push/off` removes it. |

## Leaderboard

`GET /leaderboard?days=90`: only opponent-confirmed and organizer-verified
results count. It lists only claimed profiles, and anyone can hide themselves
with the `leaderboard` preference.

## Notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | `{unread, items:[{kind, title, body, link, read_at}]}`. `link` is an in-app route (deep link). |
| POST | `/notifications/read` | `{id}` for one, or an empty body for all. |
| GET / PUT | `/me/prefs` | Booleans: `courts`, `up_next`, `feedback`, `matches`, `events`, `content`, `leaderboard`. |

Notifications are sent for:
- court assignments and "you're up next" when a round starts
- shared coach feedback (private notes never notify)
- match recorded, corrected, disputed or verified
- moving off a waitlist, check-in, and cancellation
- newly published posts

Phone push is not wired yet. See `PARITY.md`.

## Rich text

Post bodies and lesson bodies use a small Markdown subset:
- `## heading` and `### subheading`
- `**bold**`, `_italic_`
- `- list` and `1. list`
- `> quote` and `---`
- `[text](https://…)` links. Only http(s), mailto and in-app `#/` links are
  allowed.
- `![caption](media:ID)` places an uploaded photo or video belonging to the
  same post or lesson.

The renderer is `web/markdown.js`. The server and the app share it, and it
escapes everything first. `GET /posts/:slug` and lesson responses include
`body_html`, ready to display on the website.

## Learn

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/courses` | anyone | Published courses with `unlocked`, `completed` and `lessons`. Editors also see drafts. |
| GET | `/courses/:slug` | anyone | Modules and lessons with `open` and `done`, plus `locked_reason`. |
| GET | `/courses/:slug/lessons/:id` | see below | `body_html`, `video_media_id`, `prev`, `next`. Locked lessons return **403** `{locked:true}`. |
| POST / DELETE | `/lessons/:id/complete` | viewer | Marks progress or clears it. |
| GET | `/me/learning` | signed in | Membership, cohorts and started courses. |
| GET | `/me/saved` | signed in | Saved posts. |
| PUT / DELETE | `/me/saved/:postId` | signed in | Save or unsave a post. |
| POST | `/studio/courses` | editor | Create a course. |
| GET / PUT / DELETE | `/studio/courses/:id` | editor | `{title, summary, access, status, cover_media_id}` |
| POST | `/studio/courses/:id/lessons` | editor | `{title, module, body, minutes, preview, position}` |
| GET / PUT / DELETE | `/studio/lessons/:id` | editor | Also sets `video_media_id`. |
| PUT | `/admin/users/:id/membership` | admin | `{status: active\|cancelled\|none, plan, expires_at, note}` |
| GET / POST | `/cohorts` | coach, editor | `{title, course_id, starts_at, ends_at}` |
| GET / PUT / DELETE | `/cohorts/:id` | coach, editor | |
| POST | `/cohorts/:id/members` | coach, editor | `{emails: [...]}` returns `added` and `missing`. |
| DELETE | `/cohorts/:id/members/:userId` | coach, editor | |

**Course access** (`access`):
- `public`: anyone signed in can open every lesson.
- `members`: an active membership, or a cohort for the course.
- `cohort`: a cohort for the course only.

Lessons marked `preview` are open to everyone, including visitors who aren't
signed in. Lesson video and images follow the same rules. Course covers are
public once the course is published.

## Coaching

| Method | Path | Who | Notes |
|---|---|---|---|
| GET / POST | `/templates` | coach | A shared library: `{name, items:[{name, measure, target, instructions}]}` |
| GET / PUT / DELETE | `/templates/:id` | coach | Only the author (or an admin) can delete. |
| GET / POST | `/athletes/:id/assignments` | coach (post), coach or self (get) | `{template_id?, title?, due_on?, note?}`. The athlete is notified. |
| GET | `/me/assignments` | athlete | |
| PUT | `/assignments/:id` | coach, athlete | `{status: open\|done}` |
| DELETE | `/assignments/:id` | coach | |

- Creating a session with `assignment_id` marks that assignment done and links
  the session.
- A note can carry `session_id`, which is checked against the session's
  athletes. A match can carry `session_id` if you ran or played in the session.
- `GET /training/sessions/:id` includes `notes` and `matches`. Athletes see
  only what's shared with them.

## Team events and brackets

Fixed Partners and Fallout use teams of two; 3v3 Team Draft uses teams of
three.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/events/:id/register` | athlete | `{partner_player_id?}`. On fixed-partner events this signs up the partner and forms the team. |
| POST | `/events/:id/teams` | organizer | `{p1, p2, p3?, name?}` |
| POST | `/events/:id/teams/auto` | organizer | Pairs everyone without a team; for 3v3, a snake draft by rating. |
| DELETE | `/events/:id/teams/:teamId` | organizer | Refused once any team member has played. |
| POST | `/events/:id/bracket` | organizer | `{seeding: standings\|order, size?, force?}`. Uses the event's `elimination`. |

**Brackets:**
- Top seeds get byes.
- Winners (and, in double elimination, losers) move on as matches are scored.
- In double elimination, if the losers-side team wins the grand final, a
  deciding game is played.
- Correcting a score re-routes a later match while it's still unplayed.
- `GET /events/:id` includes `bracket {elimination, rounds, losers, finals, champion}`.

## Pending Interest

| Method | Path | Who | Notes |
|---|---|---|---|
| GET/POST | `/interest` | coach | `{title, kind, description, skill_level, location, timing, min_people, max_people, options: [{label, starts_at?}]}`. `kind`: training, event, league, clinic, open_play. |
| GET/PUT/DELETE | `/interest/:id` | owner | Includes `link`, `responses`, per-option tallies and `progress`. |
| POST | `/interest/:id/status` | owner | `{status: open\|closed}` |
| DELETE | `/interest/:id/responses/:rid` | owner | |
| POST | `/interest/:id/schedule` | owner | `{starts_at, ends_at?, location?, include_maybe?}`. Creates a Team Planner plan with the responders as invitees; returns `{plan_id}`. |
| GET | `/public/interest/:token?edit=` | anyone | Counts, never names. `edit` returns your own answer. |
| POST | `/public/interest/:token/respond` | anyone | `{name, email, phone?, status: interested\|maybe, option_ids, notes, edit_token?}`. Past `max_people`, interested answers join the waitlist. Returns `edit_token` for changes. |

## Team Planner

| Method | Path | Who | Notes |
|---|---|---|---|
| GET/POST | `/plans` | coach | `{title, starts_at, ends_at, timezone, location, sport, coaches, message, agenda, handoff, capacity, status, blocks, players}` |
| GET/PUT/DELETE | `/plans/:id` | owner | PUT takes `version`; a stale version returns 409 with the current plan. `blocks` (up to 30): `{start_time, end_time, court, lead, drill, instructions}`. `handoff` is coaches only. |
| POST | `/plans/:id/players` | owner | `{players: [{name, email?, phone?, athlete_id?, court?}]}`. Up to 100 per plan. |
| PUT/DELETE | `/plans/:id/players/:pid` | owner | Contact, `court`, `rsvp`, and recap text `recap_observation`, `recap_cue`, `recap_next`. |
| POST | `/plans/:id/players/:pid/recap` | owner | `{publish}`. The player sees it on their invitation page. |
| POST | `/plans/:id/invite` | owner | Publishes a draft; emails invitation links when email is set up. Returns `{sent, mail}`. |
| POST | `/plans/:id/event` | owner | `{mode?, courts?}`. A live event with everyone who said In registered. |
| GET/POST | `/plan-library` | coach | Saved `group` (players) and `drill` (`{drill, instructions}`) entries. DELETE `/plan-library/:id`. |
| GET | `/i/:token` | anyone | The player's invitation: plan, blocks, their answer, court and published recap. Never the handoff or other players' contacts. Drafts return 404. |
| POST | `/i/:token/rsvp` | anyone | `{rsvp: in\|out\|maybe}`. In when full joins the waitlist; the longest-waiting player moves in when a spot opens. |

## Phone notifications (Web Push)

| Method | Path | Notes |
|---|---|---|
| GET | `/push/key` | The VAPID public key, or 404 if push isn't configured. |
| POST | `/push/subscribe` | The browser's `PushSubscription.toJSON()`. |
| POST | `/push/unsubscribe` | `{endpoint}` |
| POST | `/push/test` | Sends a test notification to your devices. |

Every in-app notification is also pushed to the person's devices, following
their preferences. The payload is `{title, body, link}`. Generate keys with
`node server/push.js --keys`.

## Sign in with Google

- `GET /auth/google/start` redirects to Google.
- `GET /auth/google/callback` signs in and redirects to `/#/`.
- Configure it with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The redirect
  URI is `PUBLIC_URL/api/auth/google/callback`.
- A verified Google email that matches an existing account signs in to that
  account.
- Google-only accounts (`has_password: false` on `/me`) can set a password.
  They delete their account with `{confirm: "DELETE"}`.

## Admin

- `GET /admin/status`: which of email, push, Google and backups are on.
- `GET /admin/backups`: lists nightly backups.
- `GET /admin/backups/:date`: downloads a backup (a SQLite file).

## Other

- `GET /home`: the signed-in user's Home tab in one call, including open
  events, items to confirm and unread notifications.
- `GET /health`
- `GET /meta`: `{lanes, google, push}`
