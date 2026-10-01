# THE LAB App Manual

Version 1.0 · September 30, 2026

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

Use the shortcuts to Assign Development, open the Development Library, view Athletes, check Roster health, set a follow-up, start a session, or open Events desk.

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

## Sessions

Choose Start session, select athletes, use a template or add drills, and begin scoring. Complete the session when the work is finished. Linked Development Blocks advance automatically when their assigned session or retest is completed.

## Events

Events desk supports event setup, registration, brackets, court assignments, timer controls, results, and recaps. Brackets can be reviewed before the event starts. A host can start, pause, resume, and stop the timer, and can add eligible players after an event has started.

## Membership

Membership and paywall controls are built in but not activated for general use. Current access should remain complimentary until the business is ready to turn billing on. Admins can view an athlete’s membership state without charging them.

## Troubleshooting

- Only one athlete appears: open Your workspace, confirm staff access is connected, and choose Refresh athletes.
- Website roster will not load: reconnect website staff access with Brett’s or Austin’s verified account.
- Athlete cannot see app work: check Roster health. If Website only, have the athlete claim the app profile.
- Website assignment failed: open the Development Block and use Retry website delivery.
- Duplicate athlete is suspected: do not delete either record. Compare email, name, website link, sessions, and notes before merging.
- Upload fails: keep the page open and retry. The reflection text stays in the form.

## Release notes

### Version 1.0 · September 30, 2026

- Added a single roster view for website and app athletes.
- Added Roster health and connection labels.
- Added dual Development Block delivery to the website and app.
- Added delivery receipts, retry, and stable IDs to prevent duplicate website delivery.
- Preserved private coaching notes and the original website history.
- Kept membership controls available but inactive.

This manual is versioned with the app. Each meaningful app update should include a refreshed manual and a new release-note entry.
