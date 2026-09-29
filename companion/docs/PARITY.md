# Feature parity checklist

THE LAB app against the build brief. The app is an installable web app,
deployed on Render.

- **Done:** works end to end, covered by the automated tests (`npm test`)
  and the browser journey scripts in `test/e2e/`.
- **Configure:** built and tested, but switched off until a key or account is
  added in Render.
- **Blocked:** needs access to something outside this repo.
- **Next:** not built.

## 1. Connecting the ecosystem

| Item | Status | Notes |
|---|---|---|
| One shared backend for website and app | Done | `docs/API.md` is the contract. The public feed returns `body_html`, so the website can show the same articles. |
| Inspect the existing website, auth and database | Blocked | trainwiththelab.com is blocked by this environment's network policy, and the "Sites" project isn't reachable here. |
| Migrate existing website accounts and content | Blocked | Needs an export from wherever the site stores data today. |
| Point the website at this backend | Blocked | Whoever builds the site uses `docs/API.md`. |
| Security holes in `TP4L/the-lab-2` | Flagged | Sign-up can pick `coach`, and users can raise their own role. This backend only grants roles through an admin. |

## 2. Design and navigation

| Item | Status |
|---|---|
| Five tabs (Home, Train, Play, Learn, Profile), role-aware staff shortcuts | Done |
| Loading, empty, error, permission-denied and offline states | Done |
| Light and dark themes | Done |
| Accessibility: axe-core WCAG 2 A/AA plus best practice on 22 screens in both themes, zero violations | Done |
| Screen-reader walkthrough on a real iPhone and Android device | Next (needs devices) |

## 3. Accounts and player profiles

| Item | Status | Notes |
|---|---|---|
| Email and password, account recovery, account deletion, privacy explanation | Done | |
| Password-reset emails | Configure | `RESEND_API_KEY` and `MAIL_FROM`. Until then, admins give out reset links. |
| Sign in with Google | Configure | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Links to an existing account by verified email. |
| Sign in with Apple | Next | Needs an Apple Developer account and a signing key. Required by the App Store only if the iOS build offers Google sign-in. |
| Claiming a coach-made profile with no duplicates | Done | |
| Photo, hand, side, rating, goals, focus, plan, player card with QR | Done | |
| Session history, training and game results | Done | |
| Private coach notes kept separate, enforced on the server, media included | Done | |
| Membership, cohort and course access | Done | Admins grant membership. See section 8 for payments. |

## 4. Coach Workspace

| Item | Status |
|---|---|
| Search athletes, create profiles, claim codes, notes (private or shared), media | Done |
| Session templates, assigning training with a due date, "Run now" | Done |
| Individual and group sessions, notes on a session, games from a session | Done |
| Review previous sessions | Done |

## 5. Training and Scoreboard Studio

| Item | Status | Notes |
|---|---|---|
| Session builder: 1–10 drills measured by reps, score, time or feel; targets and instructions | Done | |
| One-player and four-player make/miss counters, undo, autosave, resume, offline | Done | |
| Custom scoreboards: 2–4 named sides, game to N, win by 1 or 2 | Done | |
| Timed games and best-of 1/3/5/7 | Done | When time runs out with scores level, the next point wins. |
| Round robins with partners, opponents and left/right sides | Done | In Events. |
| Session summaries | Done | |
| Voice score entry (experimental) | Done, not device-tested | Off by default. Every spoken score shows with Undo. **Not yet tested on real phones with earbuds or music.** Don't call it reliable until it is. |

## 6. Games and events

The website's event tools (Pending Interest, Team Planner and the Private
Event Desk) are rebuilt here, so events live in one system with one login.

| Item | Status | Notes |
|---|---|---|
| Casual, training and competition matches, with sides, format and scores | Done | |
| Self-recorded, opponent-confirmed, organizer-verified, disputed; correction history; duplicate checks | Done | |
| Pending Interest: interest checks with minimum and maximum, day and time options, a response link, interested / maybe / waitlist, progress, CSV export, close and reopen, set the date | Done | Converts into a Team Planner plan. |
| Team Planner: date, time zone, location, coaches, message, agenda, court blocks (up to 30), private handoff notes, players (up to 100) with courts | Done | |
| Team Planner: personal invitation links, In / Out / Maybe, waitlist with automatic promotion | Done | Invitations are emailed when email is set up; otherwise copy or text each link. |
| Team Planner: one observation, one cue, one next task per player, published to that player's link | Done | |
| Saved groups and saved drills | Done | |
| Plan into a live event | Done | Everyone who said In is registered. The website doesn't have this step. |
| Formats: Round Robin, Race to ( ), Pre-Mapped Doubles, Unlucky (0/3/6 head starts), Rivalry, Fixed Partners, 3v3 Team Draft, Fallout | Done | Rotations aim for fairness; they don't guarantee a perfect schedule. |
| Fallout single and double elimination, byes, grand-final deciding game | Done | Double elimination takes up to 8 teams. |
| Settings: courts, capacity, round limit, timed rounds, traditional or rally scoring, round ends when every court / the timer / the first court finishes, race target | Done | |
| Registration without an account, player numbers, personal player page | Done | |
| Player and spectator links, QR codes, link resets | Done | Unlisted links: anyone holding one sees names and event details. |
| Registration open or closed, show or hide who's coming | Done | |
| Walk-ins, check-in by QR or code, preview and approve the next round, stop all courts, reopen a result, confirm scores | Done | |
| Late arrivals, breaks, returns, leaving (waitlist moves up), attendance undo before the next change or round | Done | |
| Court acknowledgments ("Got it") visible to the host | Done | |
| Preview event before starting: full Fallout bracket, every Pre-Mapped round, opening matchups for rotating formats; the draw is saved and goes stale on roster or settings changes | Done | |
| Host timer: starts paused; start, stop (pause), resume, add 1 minute, reset; upcoming round length | Done | Stop timer pauses; Stop all courts ends the round. |
| Late joining for rotating formats, with a switch | Done | 3v3 and Fallout lock once started. |
| Choosing the actual court numbers | Done | Changes apply from the next round. |
| Rotation fairness table | Done | Visibility only; rest counted in rounds, not minutes. |
| Mid-match substitutions, undoing a round, late-arrival prize rules, closing registration before the last round | Next | Not on the website either. |
| Players enter their own score, host confirms | Done | |
| Weekly duplicates (1–8 drafts) | Done | |
| Calendar file, CSV of roster, results and standings | Done | |
| Linking a link registration to an account (My Events) | Done | Play → "Signed up with a link". |
| Event discovery, interest, registration, waitlist, participants | Done | |
| Leaderboard with opt-out | Done | Counts confirmed and verified results from players with accounts. |
| In-app notifications with deep links and preferences | Done | |
| Reminders 24 hours and 1 hour before events | Done | Automatic, including phone alerts for link-only players. |
| Sound chime on court changes while the page is open | Done | |
| Phone push notifications, including for link-only players, with delivery status for the host | Configure | `VAPID_*` keys. "Accepted" means the push service took it, not that the phone showed it. On iPhone, only from the Home Screen (iOS 16.4+). |
| Payment for events | Blocked | Prices can go in the event details; nothing is charged. See section 8. |
| Automated SMS | Next | Text buttons open the phone's messaging app. Sending texts automatically needs an SMS service such as Twilio. |
| Live scores offline | No | Live events refresh every 3 seconds and need a connection. |

## 7. Publishing Studio

| Item | Status |
|---|---|
| Quick Read, The Work, Field Study; drafts, review, schedule, publish, revisions | Done |
| Rich text: headings, emphasis, lists, quotes, links, inline photos and video | Done |
| Photo and video uploads with progress, retry and offline queue; draft recovery | Done |
| Contributor, editor and admin permissions | Done |
| Scheduled posts notify members when they go live | Done |

## 8. Learning and membership

| Item | Status | Notes |
|---|---|---|
| Courses, modules, lessons, video, free previews | Done | |
| Access by everyone, members or cohort, enforced on media too | Done | |
| Cohorts, progress tracking, continue learning, saved posts | Done | |
| Paid membership, booking and payments | Blocked | The current booking and payment flows need to be seen first. In a native iOS build, digital memberships must use Apple in-app purchase. |

## 9. Offline and sync

| Item | Status |
|---|---|
| App opens with no connection | Done |
| Scores, counters, scoreboards, notes, reflections, matches and post drafts work offline | Done |
| Photos and video queue offline and upload on reconnect | Done |
| Saved on device / syncing / synced indicator and sync screen | Done |
| Safe retries with no duplicates; conflicts return the latest copy | Done |

## Operations

| Item | Status | Notes |
|---|---|---|
| Nightly database backup, last 7 kept, downloadable from Admin | Done | They sit on the same disk: download one now and then for an off-site copy. Uploaded media isn't in the nightly backup; Render's disk snapshots cover it. |
| Database migrations | Done | Versioned; they only add, never destroy. |

## Before iOS and Android store release

1. **Keys in Render:** email, VAPID and Google.
2. **Website:** point it at `/api` and migrate the existing accounts and
   content.
3. **Payments:** decide on Stripe for web and in-app purchase for iOS once
   the current flows are known.
4. **Native wrapper:** use Capacitor around this app. It adds native push,
   QR scanning on iPhone and background uploads.
5. **Developer accounts:** Apple ($99/yr) and Google Play ($25). Add Sign in
   with Apple if Google sign-in stays in the iOS build.
6. **Real-device testing:**
   - courtside tap targets in sunlight
   - voice scoring with earbuds and music
   - screen readers
   - video upload on cellular
