# Discovery

Discovery is an owner-controlled, opt-in partner finder within the Render app. It uses existing login accounts but exposes a separate display name and bio, never coaching notes, contact details, or imported athlete history.

## Launch controls

Open `/#/discovery/owner`. The first deployment is **off**, with no price and purchases closed. Only the configured owner email with the admin role may change these controls. Other admins and coaches have ordinary member access.

- Availability switch: opens or closes member access. The owner can preview while it is closed.
- Paid pass: set a USD price and access length (1–365 days). This release uses one-time passes, with no automatic renewal.
- Complimentary access: grant a member days without charging. Setting days to zero revokes their Discovery passes.
- Existing accounts and athlete profiles are never automatically published on the map. Members explicitly opt in.
- Pausing freezes remaining access time using a persistent active-service clock. Reopening resumes the clock. New checkouts close immediately; previously opened Stripe sessions are expired on a best-effort basis. A payment already settling receives a full, frozen pass.
- Reports appear in the owner queue and notify the owner. Remove a reported listing or dismiss the report.

## Member behavior

Houston is the initial map center. Explicit city/neighborhood/public-court search and map movement support US locations, including a national view. Activities are Drill, Play, or Either. Search filters include radius, activity, skill level, and the next day/week.

Members post a time, location, skill range, open spots excluding the host, and a focus. Neighborhood coordinates are rounded on the server to two decimals and never stored at device precision. Public-court pins require an explicit location declaration. Device geolocation is requested only after pressing Use my area.

Hosts accept/decline requests. Acceptance checks capacity in a transaction. Host and accepted players can coordinate in the session conversation. Members can withdraw, block, report, and opt out. Opting out cancels their active listings and withdraws their requests. Expired, removed, canceled, blocked, hidden-profile, or expired-pass listings disappear from discovery. Session participation does not reserve courts or provide venue entry.

Discovery API responses and chats are online-only and are not put into browser storage or the service-worker cache. The shell and local map library are cached; external map imagery is not prefetched.

## Payment setup before opening purchases

Use the existing server-side restricted Stripe key and signed webhook endpoint:

- `STRIPE_RESTRICTED_KEY` (preferred) or existing `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PUBLIC_URL` must be the HTTPS app URL
- Endpoint: `https://the-lab-8w5d.onrender.com/api/billing/webhook`

The restricted key needs Checkout Session creation, expiration, listing, and charge retrieval. Use isolated test credentials first. Do not put credentials in source files or the browser.

Subscribe the endpoint to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `charge.refunded`
- `charge.dispute.created`
- `radar.early_fraud_warning.created`

Retain the existing Essentials subscription/invoice events. Discovery events are routed separately and do not grant Essentials membership. Verified webhook fulfillment checks stored order ownership, exact price, currency, mode and paid state; a success redirect cannot grant access. Pass fulfillment is idempotent across repeated or concurrent deliveries. Full refunds, disputes and fraud warnings revoke the affected pass; partial refunds retain it. A late success event cannot undo revocation.

Price and length are saved by the owner and snapshotted on each order. Live checkout is blocked until availability, price, billing configuration and the owner sales switch are all enabled. No products, real charges, or subscriptions are created by deployment. Tax calculation has not been enabled; configure applicable tax registrations/settings before opening purchases.

## Maps

Leaflet 1.9.4 is vendored with its BSD license. Default imagery is OpenStreetMap with visible attribution and origin-only referrers. No bulk/offline download or prefetch is implemented. Nominatim searches are explicitly submitted, server-proxied, cached for 30 days and globally limited to less than one request per second on the current single-instance Render service. Provider availability is best effort; list view remains usable if tiles fail.

Provider settings can be switched without client updates:

- `DISCOVERY_TILE_URL` (default `https://tile.openstreetmap.org/{z}/{x}/{y}.png`)
- `DISCOVERY_TILE_ATTRIBUTION`
- `DISCOVERY_GEOCODER_URL` (Nominatim-compatible search endpoint)
- `DISCOVERY_OWNER_EMAIL` (defaults to ADMIN_EMAIL; owner access stays unavailable if neither is configured)

Before increasing service instances or significant traffic, use a hosted map/geocoding provider or a shared rate limiter. Do not use the public geocoder for autocomplete or background batch searches.

## Validation

`node --test test/discovery.test.js` checks authorization, default-off behavior, price gating, opt-in, coordinate minimization, request capacity, conversation visibility, notifications, blocking, reports, opt-out, expiry/revocation, frozen time, stale settings, geocoding caching/rate limits, and isolated signed payment fulfillment/refunds.

`node test/e2e/discovery.js` checks the owner toggle and the member profile → map → post → request → accept → chat → paused-access journey, with 320/390/768/1440px layouts. It uses an isolated fixture database and test identities. Set `CHROMIUM` to an available Chromium binary.

## Session continuity and Houston pilot

Confirmed participation is tied to the pass used when the host posted or accepted a member. Natural expiration preserves that session's details, calendar download, and conversation through its end. A 30-day follow-up window permits private outcome check-ins and read-only chat history. Pending requests do not gain this access. Explicit pass revocation/refund, blocking, profile opt-out, removed listings, and the owner's global pause still take priority. New posts and new acceptances always require current access.

Members can specify reservation status, venue entry restrictions, venue fees, and arrival instructions. Existing listings display "Confirm with host" until updated. These are host-provided details, not automatic court reservations or verified venue policies.

Confirmed hosts and players receive one reminder around 24 hours and one within an hour before start, plus a single follow-up after the session. Jobs run each minute in the existing server. Delivery is keyed by session, member, time, and reminder type, survives restarts, supports late acceptances and rescheduling, and respects Discovery/reminder/email/push preferences. Pausing stops reminders. External email and push still depend on configured providers and device permission.

The calendar button downloads an authenticated RFC 5545 .ics file with UTC times, escaped/folded text, venue details, a stable UID and revision, and a link back to the session. It does not establish a live calendar subscription; changes must be checked in THE LAB or downloaded again.

After a session, participants can record "I attended", "The session did not happen", or "I could not attend" and update that response within 30 days. The owner sees sessions reported played, sessions corroborated by at least two attended responses without a conflicting canceled response, repeat participants, and conflicting responses. These are self-reports, not verified attendance or public player ratings.

The owner pilot panel provides the signup link, complimentary-pass controls, and a shortcut to post real sessions. No invitations are sent automatically and no example sessions or athletes are inserted into production. A practical first pilot is a small Houston group with several real sessions, then review reported meetups and repeat participation before opening purchases.

## Payment launch still requires account configuration

The app requires an owner-entered refund policy before sales can open. Members can read it alongside the price before Checkout. The exact policy, price, and duration are stored with each order. If the offer changes while a member is reviewing it, they must refresh before opening Checkout.

Use a sandbox account and its restricted key to perform a real Checkout and refund test before live activation. Automated tests cover actual Stripe signature verification, duplicate fulfillment, refunds, disputes and authorization, but do not replace a connected sandbox checkout. In production, keep the existing owner availability and sales switches off until ready. A connector connection alone does not install an API key in Render.

## Houston clubs and courts

`GET /api/discovery/venues` uses the same owner-preview, pause, and paid-pass gate as member discovery. The checked-in catalog at `server/catalog/houston-venues.json` imports the 139 records in Brett's `Houston_Pickleball_Market_Audit.xlsx` (Court inventory and Sources tabs, October 13, 2026). It contains public venue information only; it is not a list of member locations. No changes to athlete records or payment settings are involved.

The default view includes 73 entries marked operating in that research, filtered to the chosen distance. All research entries can be selected explicitly; planned, closed, unresolved, and no-pickleball-verified entries remain labeled. Do not describe the catalog as a live operational check or all 139 records as active clubs. The directory covers Greater Houston; the US view still supports player sessions nationwide. Venue access, availability, and membership requirements must be checked with the venue.

The map and matching list support name/address/ZIP search, category and research-status filters, distances, pin popups, directions, venue source links, and club-name labels. Labels avoid overlapping one another; wider zooms show up to six names and zooming in reveals more. All, Clubs & courts, and Player sessions control the displayed layers. The Houston clubs button restores the region and clears club search filters.

Coordinates retain source provenance. On November 15, 2026, exact ArcGIS address matches corrected H011 (Life Time Sugar Land), H035 (Ion Pickle Lab, previously incorrectly geocoded to 77045), and H130 (Upside SportsPlex). H124 (Cimarron Park) matched a different street; its pin is withheld and its record remains searchable with a notice. There are 138 mapped records. Remaining pins are the audit's approximate facility coordinates, not surveyed court entrances. The catalog is server-side and excluded from the service-worker cache.

Validation: the Discovery API suite checks access/expiry/pause, search, category, radius, status exclusions, source links, and coordinate corrections. `test/e2e/discovery.js` checks club pins, search, address popups, direction links, label/layer controls, and 320/390/768/1440px layouts, followed by the existing session lifecycle.
