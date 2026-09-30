# Padel board

Private board at `/padel`. Uses the existing LAB session and durable SQLite database.
Access requires B.Adams’ existing admin account. No new credentials or service are needed.

Source: `Board.tsx` and `shots.ts`. Rebuild the checked-in browser bundle with `npm install && npm run build` in this directory. Styles live in `../web/padel/board.css`. Render serves the built files without installing frontend dependencies.

The September 2026 baseline is a reported estimate, separate from dated records. Sites entries are not migrated or synchronized automatically. Only the production LAB service has a persistent disk; the demo service remains ephemeral.
