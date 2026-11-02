# Deploying the API (needed for TOS logging, IP bans, VPN check)

The site files come from GitHub and run in about:blank - that part is fine. But GitHub can only host
static files. The `api/` folder is server code (Vercel serverless functions) and has to run on a server.
The site calls that server over the internet, from wherever it is open, so about:blank is not a problem.

The Vercel project at itsukis-chat-hub.vercel.app does NOT contain this folder (it returns 404 for /api/tos),
which is why nothing works. Do NOT touch that project (it serves your launcher). Make a new one:

1. vercel.com > Add New > Project > import the GitHub repo jace01b-web/itsukis-chat-hub-obfuscated.
   Framework preset: Other. Root directory: the repo root (where the `api` folder is). Name it e.g. `ich-api`.
2. Settings > Environment Variables (then Redeploy):
   - FIREBASE_SA            full service-account JSON (Firebase console > Project settings > Service accounts)
   - IP_HASH_SALT           any long random string (16+ chars). Never change it later.
   - DISCORD_WEBHOOK_URL    your Discord webhook
   - BUILD_SECRET           (optional) only if you use tools/stamp-build.js
   - VPN_API_KEY            (optional) free key from ipapi.is, turns on VPN/proxy blocking
   - TOS_VERSION            leave unset (or set to 5)
3. Open https://<your-project>.vercel.app/api/tos in a browser. You should see {"error":"POST only"}.
   A 404 page means the api folder is not in that deployment.
4. In js/core/config.js set TOS_API to that URL (no trailing slash), push to GitHub.
5. Settings > Moderation > TOS acceptances > Test the server. It should say Working and post to Discord.
