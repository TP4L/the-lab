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

## Other

- `GET /home`: the signed-in user's Home tab in one call.
- `GET /health`, `GET /meta`.
