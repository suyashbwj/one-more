# Hosting One More

## Current status

The working app is live at **https://one-more.one-more.workers.dev** on Cloudflare, with a password gate and persistent SQLite storage. The project password is shared privately with reviewers. The GitHub Pages walkthrough is also public.

Cloudflare Workers Free supports SQLite-backed Durable Objects. The app shares its existing workout store and command parser between Node and Cloudflare; it does not maintain a separate set of workout rules. Cloudflare uses `transactionSync` for atomic mutations and request replay storage. Node uses SQLite transactions. No personal local database is uploaded.

## Cloudflare deployment

1. Use a Cloudflare account on the Workers Free plan. Run `npx wrangler login` and approve the CLI connection.
2. Run `npm ci`, `npm test`, `npm run check:worker`, and `npm run build`.
3. Set secrets using the hidden prompts:
   - `npx wrangler secret put APP_PASSWORD` (a random password of at least 16 characters)
   - `npx wrangler secret put ELEVENLABS_API_KEY`
   - `npx wrangler secret put ELEVENLABS_AGENT_ID`
4. Run `npm run deploy:cloudflare`. This creates the SQLite-backed `Journal` object and uploads frontend assets. If Wrangler asks to create the Worker while setting the first secret, use this project's `one-more` Worker.
5. Open the returned HTTPS URL. Confirm unauthenticated `/api/state` and `/api/voice/signed-url` return 401, then sign in and log a sample workout. Reload and verify persistence. Confirm signed-URL issuance without logging the URL itself.
6. Add the live URL to the README and application. Give the reviewer the project password separately. Do not put either the password or API key in the public repository.

The app fails closed until a sufficiently long `APP_PASSWORD` is configured. The public `/healthz` route returns only an availability status. Login uses an eight-hour, signed, HttpOnly, Secure, SameSite cookie. The runtime blocks cross-origin requests and limits request bodies. Login attempts are rate limited in persistent storage. The hosted journal is shared between reviewers; the entry screen asks for demonstration data only.

Voice is optional. The provider enforces the configured 60-second session duration, five daily calls, one concurrent call, and no paid bursting. Manual logging remains available when voice credits or daily calls run out. A signed URL is a short-lived credential and must not be logged or shared. The local key created September 14 expires October 14, 2026; rotate it in Cloudflare before then if voice should stay available.

## Local Cloudflare verification

Create a gitignored `.dev.vars` containing `APP_PASSWORD=local-worker-test-password`, then run `npm run dev:cloudflare`. It uses a separate local SQLite database under `.wrangler`; production data is unaffected. The Node app continues to use `data/one-more.sqlite`.

Verified September 14, 2026 against the local Workers runtime: unauthenticated denial, invalid password denial, secure cookie issuance, authenticated state access, set persistence, idempotent replay, stale-edit conflict, workout completion, cross-origin denial, and oversized-body denial. Twenty Node tests and both TypeScript builds pass. The live HTTPS deployment also passed login, unauthorized API denial, mutation persistence, exact-retry handling, stale-edit rejection, and cleanup checks. Five labeled sample workouts are available. A real microphone conversation remains pending. Hosted voice credentials are configured as Cloudflare secrets. The authenticated hosted signed-URL endpoint returned HTTP 200 and a connection URL on September 14, 2026. No microphone conversation was started during this check.

## Optional Node hosting

A Dockerfile and Railway configuration are also included. Use a persistent volume, set `DB_PATH=/data/one-more.sqlite`, `HOST=0.0.0.0`, `APP_PASSWORD`, `COOKIE_SECURE=1`, `TRUST_PROXY=1`, and `APP_ORIGIN` to the exact HTTPS origin. Do not deploy this app to an ephemeral filesystem if workout persistence matters. No Railway project was created for this app.
