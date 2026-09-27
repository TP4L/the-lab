# Feature parity checklist

Status of THE LAB app against the build brief. Last updated: this build (core
loop, Publishing Studio and Play, as an installable web app).

- **Done:** works end to end and is covered by the automated tests or the
  browser run.
- **Infra:** the code is ready, but it needs a service or account to be set up.
- **Next:** not built yet.

## 1. Connecting the ecosystem

| Item | Status | Notes |
|---|---|---|
| Inspect the existing website, auth and database | **Blocked** | trainwiththelab.com is blocked by this environment's network policy. The "Sites" project ID isn't reachable with any tool here. `TP4L/the-lab-2` is a Supabase prototype with placeholder keys. |
| One shared backend for website and app | Done | `companion/server` is that backend. The website should read and write through `docs/API.md` rather than keep its own copy. |
| Migrate existing website accounts and data | Next | Needs an export from wherever the site stores data today. |
| Security holes in `the-lab-2` schema | Flagged | Sign-up can choose `coach`, and users can update their own role. This backend grants roles only through an admin. |

## 2. Design and navigation

| Item | Status |
|---|---|
| Five tabs: Home, Train, Play, Learn, Profile | Done |
| Home: focus, recent sessions, coach notes, new posts, quick actions | Done |
| Upcoming events on Home | Done |
| Staff entry to Coach Workspace, Publishing Studio, Admin | Done, role-aware |
| Loading, empty, error, permission-denied and offline states | Done |
| Light and dark themes, keyboard focus, skip link, labelled controls | Done |
| Full screen-reader audit on real devices | Next |

## 3. Accounts and player profiles

| Item | Status | Notes |
|---|---|---|
| Email and password sign-in | Done | |
| Other sign-in methods (Google, Apple) | Next | Depends on what the website uses today. |
| Secure profile claiming, no duplicates | Done | One-time code, optionally locked to an email, rate limited. |
| Photo, name, hand, side, rating | Done | |
| Goals (athlete), focus and plan (coach-owned) | Done | |
| Session history and training results | Done | |
| Game results | Done | Match history, W/L, status. |
| Coach-shared notes, reflections, photos and videos | Done | |
| Private coach notes kept separate, enforced on the server, media included | Done | Tested in journey 6. |
| Player card with ID | Done | |
| QR code for check-in | Done | Built-in encoder, checked against an independent decoder. |
| Membership, cohort and course access | Next | |
| Account recovery | Infra | Reset links work. Emailing them needs an email provider; until then admins issue links. |
| Account deletion and privacy explanation | Done | |

## 4. Coach Workspace

| Item | Status |
|---|---|
| Search athletes, create profiles, claim codes | Done |
| Ongoing notes with clear Private / Shared labels | Done |
| Upload media with progress and retry | Done |
| Edit focus and plan (assigning training) | Done |
| Run individual or group sessions and record per athlete | Done |
| Review previous sessions | Done |
| Assign a training plan template to an athlete | Next |

## 5. Training and Scoreboard Studio

| Item | Status | Notes |
|---|---|---|
| Session builder, 1–10 drills measured by reps, score, time or feel | Done | The brief says 4–10; the builder starts with 4 and allows fewer for quick counters. |
| Targets, instructions, timestamps | Done | Every tap is timestamped. |
| Notes and reflections per session | Partial | Notes can carry a `session_id` in the API; the UI adds notes on the athlete. |
| Single-player make/miss counter | Done | |
| Four-player counter, one large square each, separate make/miss areas | Done | |
| Undo, accidental-tap recovery, autosave, resume after closing | Done | Tested in the browser, including offline. |
| Session summary, individual and group | Done | |
| Custom scoreboards with editable names and scoring rules | Next | |
| Timed games, best-of formats | Next | Time measure with a stopwatch is done. |
| Round-robin schedules | Done | Partners, opponents, left/right sides, per-court completion checks. |
| Voice score entry (experimental) | Next | Must be tested on real devices with earbuds and music before being called reliable. |

## 6. Games and events

| Item | Status | Notes |
|---|---|---|
| Record casual, training and competition matches: players, teams, sides, format, scores, date | Done | Singles and doubles; to 11/15/21, win by 1 or 2, best of 1/3/5. |
| Link a match to an event | Done | |
| Link a match to a training session | Partial | The API accepts `session_id`; the UI doesn't set it yet. |
| Self-recorded, opponent-confirmed, organizer-verified, disputed | Done | Tested (journey 3 and match rules). |
| Duplicate prevention | Done | Device IDs for retries; same players and scores within 12 hours prompts first. |
| Correction history | Done | Every correction keeps the previous version and a reason. |
| Event discovery, interest, registration, waitlist, participant lists | Done | |
| QR check-in | Done | Camera scanning where the browser supports it (Chrome on Android). On iPhone Safari the organizer types the code under the QR. A native build adds scanning everywhere. |
| Court assignments, rotations, live scores, standings | Done | Live scores refresh every 20 seconds on the event screen. |
| Late arrivals and early departures under organizer control | Done | Check in or switch a player to "Left"; the next round adjusts. |
| Leaderboards | Done | Confirmed and verified results only; opt-out setting. |
| In-app notifications with deep links and per-type opt-in | Done | |
| Phone push notifications | Infra | Web push needs VAPID keys and a push sender. On iOS it works only for home-screen installs (16.4+). Native builds use APNs/FCM. |
| Reminders before sessions and events | Next | Needs a scheduler (cron) to send them at the right time. |
| Team events (fixed partners), brackets | Next | |

## 7. Publishing Studio

| Item | Status |
|---|---|
| Create and edit posts in Quick Read, The Work, Field Study | Done |
| Upload photos and short video, choose thumbnail | Done |
| Titles, captions, tags, author credit | Done |
| Preview, drafts, submit, return with note, schedule, publish | Done |
| Edit published posts (editors), revision history, status shown | Done |
| Contributor, editor and admin permissions, admin manages access | Done |
| Same content on website and app | Done in the API. The website needs to render `/api/posts`. |
| Upload progress, retry, draft recovery (including conflicts) | Done |
| Recording video in-app | Partial: the file picker opens the camera on phones. |
| Rich text (headings, links, inline images) | Next: bodies are plain paragraphs today. |

## 8. Learning and membership

| Item | Status |
|---|---|
| Field Notes feed and reader, public preview | Done |
| Courses, modules, cohorts, progress, saved posts | Next |
| Booking and payments | Blocked: the existing flows need inspecting first. App-store rules also apply to in-app purchases in native builds. |

## 9. Offline and sync

| Item | Status |
|---|---|
| App opens with no connection (service worker) | Done |
| Scorekeeping, counters, notes, reflections and post drafts work offline | Done |
| Saved on device / syncing / synced indicator, and a sync screen | Done |
| Queued writes retried safely, with no duplicates | Done (device-generated IDs everywhere) |
| Conflicts: scores merge; session and post edits return 409 with the latest copy | Done |
| Offline media uploads queued in the background | Next: today uploads need a connection and say so. |
| Features that need a connection are labelled | Done |

## Before iOS and Android store release

1. **Hosting.** Deploy the server over HTTPS with a persistent disk
   (Render, Fly.io or Railway). Set `ADMIN_EMAIL`, `PUBLIC_URL` and
   `SECURE_COOKIES=1`.
2. **Email.** Connect an email provider (for example Resend or Postmark) to
   `onResetLink`.
3. **Backups.** Nightly copies of the SQLite file and the media folder. Move
   media to object storage once it grows.
4. **Website.** Point trainwiththelab.com at `/api`, and migrate its existing
   accounts and content.
5. **Native wrapper.** Use Capacitor for store builds, or rebuild in React
   Native if the native features in the brief (voice, background upload,
   push) outgrow the web.
6. **Accounts.** Apple Developer ($99/yr) and Google Play ($25). Apple requires
   in-app account deletion (done) and Sign in with Apple if other social
   logins are offered.
7. **Real-device testing.** Courtside tap targets in sunlight, wake lock,
   video upload on cellular, iOS storage eviction for installed web apps.
8. **Push.** Connect web push or native push to the notifications that already exist.
