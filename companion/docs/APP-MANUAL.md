# THE LAB App Manual

Version 1.4 · October 2, 2026

Live app: https://the-lab-8w5d.onrender.com

## What THE LAB connects

THE LAB combines the website athlete record with the app training experience. Coaches can see the connected roster, assign a complete Development Block, run training, review evidence, and set the next step. Athletes can see assigned learning and training, upload evidence, answer reflection questions, and read coach feedback.

The website and app remain separate delivery destinations. The app shows a delivery receipt so a coach can confirm where an assignment arrived.

## Roles

- Athlete: views assigned work, sessions, media, notes shared with them, questions, feedback, and membership status.
- Coach: views assigned athletes, writes private or shared notes, creates Development Blocks, runs sessions, reviews evidence, and manages events.
- Admin: manages access and membership settings in addition to coach tools.

Private coaching notes are never shown to athletes.

## Sign in and connect

1. Open the live app and sign in with the email used for THE LAB.
2. Brett and Austin should choose the staff connection when prompted. This connects their verified website identity to the matching app account.
3. Athletes should sign in with their own account. If a profile has not been claimed, a coach can provide its claim code.
4. Do not create a duplicate athlete when the athlete already exists on the website. Open Your workspace and refresh the roster first.

## Coaching Dashboard

Open Coaching Dashboard to see reviews, overdue work, the next seven days, unassigned follow-ups, and the athlete count across the app and website.

The four primary actions are always shown first:

- Athletes: open the combined roster, profiles, notes, and history.
- Assign development: connect a player problem to learning, training, evidence, and a retest.
- Start a session: plan, score, and save court work.
- Events: manage participants, courts, brackets, and results.

Open More coaching tools for the Development Library, Roster health, Follow-ups, and Pre-session check-ins. Use the compact counters to jump toward work needing review, overdue work, the next seven days, or unassigned work. Search and filters narrow the Action Queue without changing any records.

## Roster health

Roster health explains how each athlete is connected:

- Website + app: the athlete has both destinations and receives work in both.
- Website only: the athlete receives website work but has not claimed an app profile.
- App only: the athlete receives app work but has no linked website record.
- Needs setup: the record has neither a website link nor a claimed app account.

Refresh athletes before recreating anyone. Website athletes are mirrored into the coaching roster and shown only once in Your workspace.

## Assign a Development Block

1. Choose Assign Development.
2. Select one athlete or a group.
3. Add a block title and the player problem.
4. Choose the read target: height, time, and/or balance.
5. Set the starting state, desired state, error layer, and intensity.
6. Optionally connect a learning lesson and training situation.
7. Add the constraint, expected ball, success evidence, reflection question, and due date.
8. Optionally save the pathway to the Development Library.
9. Choose Assign Development Block.

The app keeps one Development Block as the source and sends it to every available destination. A stable delivery ID prevents a retry from creating a second website assignment.

## Check delivery

Open the Development Block and look at Delivery check.

- App delivered: the athlete has a claimed app account and can receive the app notification.
- App profile not claimed: the block is saved, but the athlete needs to claim the app profile.
- Website delivered: the website accepted the assignment.
- Website needs retry: the app saved the block but could not confirm website delivery. Choose Retry website delivery.
- No website profile: no website destination is linked for this athlete.

Never recreate the Development Block after a delivery error. Use Retry website delivery so the same delivery ID is reused.

## Email notifications

When email delivery is configured, every new in-app notification can also be emailed: shared coach notes, Development Blocks, training updates, matches, events, reminders, and new Field Notes. Private coach notes are not emailed because they never create an athlete notification.

Athletes can open Profile, expand Notifications and privacy, and switch Email notifications on or off. Category switches such as Coach feedback or Training also apply. Every email links back to the relevant place in THE LAB, and repeated requests reuse an idempotency key so the same notification is not sent twice.

## Athlete learning and evidence

The Development Block follows Learn, Train, Evidence, Review, and Retest. The athlete opens linked lessons and assigned training, completes the work, then uploads an optional photo or video with a reflection and confidence score. The submission enters the coach review queue.

The coach can share feedback, change the stage, and create a retest plan. Marking the block Ready to retest creates the next training assignment. A completed retest returns the block to coach review.

## Athlete profiles, notes, and media

Use Your workspace to open a website athlete. Overview shows current training focuses and session plans. Assign training publishes a next step. Notes lets a coach choose Private or Shared. Reflections holds athlete responses and coach feedback.

App athlete profiles contain app sessions, assignments, measurements, media, and Development Blocks. Website athletes that are mirrored into the app roster keep their original website history.

### Coach Athlete Workspace

Open an app athlete to use the courtside coaching workspace:

- Today shows the current focus, plan, activity totals, open work, and Quick Capture.
- Plan contains Development Blocks and assigned training.
- Notes holds the complete coaching and reflection record.
- Sessions holds saved session results and shortcuts to start a new session or counter.
- Media holds the athlete’s coaching photos and videos.
- Progress holds goals, sport, measurements, playing profile, and development plan.
- Access holds membership status, coach access, and claim-code controls.

Quick Capture saves private notes by default. Change the visibility to Shared with athlete only when the athlete should receive the feedback. A photo or video can be attached to the same note.

## Sessions

Choose Start session, select athletes, use a template or add drills, and begin scoring. Complete the session when the work is finished. Linked Development Blocks advance automatically when their assigned session or retest is completed.

## Events

Events desk supports event setup, registration, brackets, court assignments, timer controls, results, and recaps. Brackets can be reviewed before the event starts. A host can start, pause, resume, and stop the timer, and can add eligible players after an event has started.

As soon as the first person registers, the event page and that player’s personal event screen display an Event Board Preview. Registered players fill the numbered positions and the remaining positions appear as Open spots. The preview uses the selected courts, event capacity, and format; players beyond the active court positions appear in the Rotation / waiting deck. It is a visualization only—not a final draw. Real partners, opponents, courts, and brackets are generated or confirmed when the host starts the event.

## Skill progress (My Progress)

Coaches rate each athlete on a set of skill attributes from 1 to 5 (Learning, Developing, Consistent, Strong, Weapon) and set goals. Ratings are kept as history, so the athlete sees the trend for each skill, the change since the last assessment, and every comment.

- Athletes open My Progress from the home screen or `#/skills`. Goals sit at the top; each skill expands to a chart and the rating history. "What the 1–5 ratings mean" explains the scale.
- Coaches open an athlete, then Skill progress or Rate skills. On Rate skills, tap a number for each skill observed today and add an optional comment; unrated skills are skipped. Goals are added on the same screen and can be started, completed, reopened or removed.
- Attributes (the skills being rated) are managed by coaches at Coaching tools → Skill attributes. Add new ones, rename, or retire. Retired attributes keep their past ratings visible.
- The athlete is notified when ratings are saved, a goal is added, or a goal is completed.

## Shop, packs and credits

Athletes buy private sessions and packs at `#/shop`. Each product grants credits (private, small-group or flexible) that sit on the athlete's account with an optional expiry. Online payment runs through Stripe Checkout as a one-off charge and credits are added only after the verified webhook confirms payment. A pack purchase never changes LAB Essentials membership.

- Coaches manage products at Coaching tools → Products & pricing (name, type, price, credits, expiry, optional Stripe Price ID). Hidden products stay on the books for past orders.
- From an athlete's Credits page a coach checks off a session (one tap, one credit), records a sale paid by cash, Venmo, Zelle or comp, or adjusts credits with a reason. Every change is in the ledger.
- Sales shows revenue, orders by product and credits outstanding for 30, 90 or 365 days.
- `#/join` is the public entry: Field Notes (free) → LAB Essentials ($8/month) → coaching packs. Signed-out visitors to Field Notes see a Join banner.
- Athletes are notified when a payment lands, when a coach records a sale, and when they are down to one credit.

## The thread

Every athlete has one thread: coach notes and replies, the athlete's reflections, questions and videos, pre-session check-ins and the coach's plan, skill assessments, goals, completed sessions and Development Blocks, in one chronological place. Athletes open it from Home → Thread (`#/thread`); coaches open it from the athlete's page (`#/coach/:id/thread`).

- Either side writes at the bottom. Coaches can mark a note Private (coach only); shared notes notify the athlete.
- A coach can Reply to an athlete message, which also clears it from the review queue, or use Mark seen to clear without replying.
- Filters: Messages, Check-ins, Assessments, Activity. Items that live elsewhere (a check-in, an assessment, a session) link out with Open.
- Review items on Coach Today now open the thread.

## LAB tags

The decision-engine vocabulary runs through the app. Every skill attribute is mapped to the read it depends on (Height, Time, Balance) and a LAB level band (1–13); goals inherit the reads of their skill; notes and replies in the thread can be tagged with a read, state, need, error layer and call. My Progress opens with "The LAB lens": the athlete's average rating per read across the skills mapped to it, with the trend since the last assessment. Coaches set reads and level bands on Coaching tools → Skill attributes.

## Progress reports

A report is a snapshot of a period for one athlete: coached sessions, skills with start/now/change and the latest comment, the LAB lens, goals completed and open, shared coach notes, and a summary written by the coach. Open an athlete → Report, pick the period (this month, last month, 30/90 days or custom), edit the summary (a draft is pre-written from the data), and Publish. Publishing freezes the numbers and creates a share link (`#/report/<token>`) that opens without signing in and prints cleanly; it can be revoked later. The athlete is notified and sees reports under My Progress → Reports. Private notes never appear in a report.

## Business pulse

Coach Today → Pulse (`#/coach/pulse`) is the weekly read on the business: active, lapsing and new clients; revenue for the last 30 days against the prior 30 with an 8-week chart; credits outstanding, expiring and athletes who are out; sessions and assessments by week; upcoming event fill; and a Reach out list that ranks people by what needs attention (out of credits, messages waiting, lapsing, credits expiring, due for assessment, new this month). Everything is computed from existing records; nothing extra to enter.

## Membership

Membership and paywall controls are built in but not activated for general use. Current access should remain complimentary until the business is ready to turn billing on. Admins can view an athlete’s membership state without charging them.

## Troubleshooting

- Only one athlete appears: open Your workspace, confirm staff access is connected, and choose Refresh athletes.
- Website roster will not load: reconnect website staff access with Brett’s or Austin’s verified account.
- Athlete cannot see app work: check Roster health. If Website only, have the athlete claim the app profile.
- Website assignment failed: open the Development Block and use Retry website delivery.
- Duplicate athlete is suspected: do not delete either record. Compare email, name, website link, sessions, and notes before merging.
- Upload fails: keep the page open and retry. The reflection text stays in the form.

## Coach Athlete Workspace

Open **Coaching → Athletes**, then choose an athlete. Website athletes and app athletes use the same app workspace once the website roster has synced.

- **Today:** review the current focus, capture a typed observation, attach media, or complete a session closeout.
- **Plan:** assign training and manage Development Blocks.
- **Communication:** read shared coach notes, athlete reflections and replies in one conversation. Reply directly to an unread athlete reflection.
- **Notes:** review the full coaching record, including coach-only private notes.
- **Sessions / Media / Progress:** review court work, visual evidence, goals and measurements.
- **Access:** manage membership access and add another verified coach by their THE LAB account email.

### Complete a session closeout

1. Open the athlete and stay on **Today**.
2. Choose the session if it was recorded in the app.
3. Record what improved, what still needs work and the next action.
4. Choose whether the recap is shared with the athlete or remains coach-only.
5. Leave **Assign the next action** selected to create athlete work.
6. Leave **Add to the coaching follow-up list** selected to create a coach reminder. Add a date when timing matters.
7. Select **Complete closeout**. Shared recaps and assignments trigger the athlete's normal in-app/email notification rules.

### Add Brett, Austin or another coach

Open **Access**, enter the email used by that person's existing THE LAB coach account, and select **Add coach**. This grants access to the athlete's private notes and coaching controls; it does not create a second athlete profile.

## Release notes

### Version 1.4 · October 2, 2026

- Added a Communication tab for shared coach notes, athlete reflections and direct replies.
- Added structured Quick Capture types so observations can be identified at a glance.
- Added a one-minute session closeout that saves the recap, assigns the next action and creates a coach follow-up.
- Added coach access management for Brett, Austin and other verified coach accounts.
- Kept website and app athletes in the existing unified roster and Coach Athlete Workspace.

### Version 1.3 · October 1, 2026

- Added the Coach Athlete Workspace with Today, Plan, Notes, Sessions, Media, Progress, and Access sections.
- Added a courtside Quick Capture surface with private-by-default notes and optional media.
- Added an immediate athlete snapshot for current focus, sessions, media, notes, and open work.
- Reorganized the existing athlete record without removing its assignments, history, measurements, or membership controls.

### Version 1.2 · October 1, 2026

- Simplified the Coaching Dashboard around four primary actions.
- Moved secondary destinations into a quieter More coaching tools menu.
- Compacted the status counters and combined search and filters into one control bar.
- Reduced mobile scrolling while preserving reviews, follow-ups, roster health, assignments, sessions, and events.

### Version 1.1 · October 1, 2026

- Added an Event Board Preview that appears after the first registration.
- Added the same live preview to each registered player’s Courts or Event Board tab.
- Added visible open spots so players can picture the event before it fills.
- Added court-by-court layouts and a Rotation / waiting deck for larger groups.
- Kept projected positions separate from the final draw and live assignments.

### Version 1.0 · September 30, 2026

- Added a single roster view for website and app athletes.
- Added Roster health and connection labels.
- Added dual Development Block delivery to the website and app.
- Added delivery receipts, retry, and stable IDs to prevent duplicate website delivery.
- Preserved private coaching notes and the original website history.
- Kept membership controls available but inactive.

This manual is versioned with the app. Each meaningful app update should include a refreshed manual and a new release-note entry.
