# Security setup (do these IN ORDER, API first, then rules, then the site)

## 0. Do this first: the old Discord webhook was public
It was in js/core/config.js, so anyone could post fake "TOS accepted" logs. In Discord: Server settings > Integrations > Webhooks > delete it, make a new one.
Also regenerate your Nyckel client secret (it is still in config.js, visible to everyone) and, ideally, move NSFW checks behind an /api function.

## 1. Vercel environment variables
| Name | What |
|---|---|
| FIREBASE_SA | whole service-account JSON (Firebase console > Project settings > Service accounts > Generate new private key) |
| DISCORD_WEBHOOK_URL | the NEW webhook |
| IP_HASH_SALT | long random string. Never change it later. |
| BUILD_SECRET | long random string. Same value you use with tools/stamp-build.js. NEVER commit it. |
| MIN_BUILD | 2026-10-20.02 (anything older is refused by the server) |
| VPN_API_KEY | optional, free from ipapi.is |
Redeploy the API. Do not commit these anywhere.

## 2. Rules
Paste database.rules.json into Realtime Database > Rules. Chat now needs a live server grant (attest/<uid>), a server-written TOS v2, and a server-clock cooldown.
Emergency kill switch: in the Firebase console set `security/enforce` to `false` (only the console can write it). Delete it again afterwards.

## 3. Every release
`BUILD_SECRET=... node tools/stamp-build.js` then push. To kill all older copies instantly, raise MIN_BUILD in Vercel to the new label.
