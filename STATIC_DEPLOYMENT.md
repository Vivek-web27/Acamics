# Acamics — Static Deployment

This version is prepared for static hosting.

## Deploy
- Netlify: the repository root is already configured with `netlify.toml` to publish `frontend/`.
- Vercel: set the project root/publish output to `frontend/` as a static site.

## Important
- Official events are loaded from `frontend/data/events.json`.
- Personal events remain in each visitor's browser via `localStorage`.
- Category posters are in `frontend/posters/`.
- `.ics` export works without a backend.
- Server-backed reminders/Web Push are intentionally disabled in this shared static version.
- The `backend/` folder is retained for the original local/server version, but is not required by the static deployment.
