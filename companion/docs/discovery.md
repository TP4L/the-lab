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
