# Shared THE LAB identity and profile

The website remains the identity authority for approved members with a claimed athlete profile. The app offers Continue with THE LAB; member home opens the same player profile through /my-profile.

Sign-in uses a browser-bound, ten-minute server-side state and a SHA-256 proof challenge. Website approval produces a two-minute, single-use grant. The app exchanges it server-to-server, records the stable website subject and athlete mapping, and creates its existing secure session cookie. The website token never enters browser storage.

Existing linked accounts retain their app user and athlete IDs. Email matches alone never sign someone into an existing app account: sign into that account once before linking. Conflicting identity mappings require review. New accounts receive only the athlete role. Staff permissions are never inferred from website identity.

For connected athletes, name, hand, rating, goals and preferred side are read from the website profiles record; app edits update those same fields. Existing website details take precedence. The original app details are retained once in website_profile_originals. Website-only journal and assessment fields are preserved during app writes. Existing event, match, media and notes tables are preserved. Website coach-only notes are excluded by the existing scoped bridge.

Website coaching and reflections remain in their original store; app match history, media and local notes stay in the app. This is a common identity and shared profile surface with shared basic fields, not wholesale database consolidation or synchronization of both event engines. Signing out ends the session on that surface; existing sessions on the other surface remain independent. Approved membership and the athlete claim are rechecked on website access. Membership revocation blocks website data and future website sign-in; local app account access is unchanged.

Deployment: deploy the Site routes and additive app_signin_grants migration, then this companion commit. Existing password/Google sign-in and legacy link codes remain available. Tests: companion suite plus Site tests/app-bridge.mjs exercise the two real route implementations against isolated SQLite databases (never production data).
