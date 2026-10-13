# TOS gate, IP bans, VPN/proxy block: setup

Deploy the **API first**, then publish the site changes. If the site goes live before the API does, nobody can accept the TOS, so nobody can chat.

## 1. Deploy the API (Vercel)
The `api/` folder is a set of Vercel serverless functions. Import this repo into Vercel (or redeploy the existing project) and add these **Environment Variables**:

| Name | Required | What it is |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | yes | Your Discord webhook. It lives only here, never in the browser. |
| `IP_HASH_SALT` | yes | Any long random string. IPs are scrambled with it before they go in the database. Don't change it later or old IP bans stop matching. |
| `VPN_API_KEY` | for VPN block | Free key from https://ipapi.is (1,000 lookups/day free). Without it, VPN/proxy detection is skipped. |
| `BLOCK_DATACENTER` | no | `1` = also treat hosting/datacenter IPs as VPNs. Off by default because school filters can look like datacenters. |

Then open `js/core/config.js` and make sure `TOS_API` is the URL where the API is deployed (default: `https://itsukis-chat-hub.vercel.app`).

## 2. Database rules (Firebase console > Realtime Database > Rules)
Merge the two nodes from `database-rules-tos-block.json` (`tosAccepted` and `ipBans`) into your existing rules under `"rules"`. I couldn't see your live rules, so this is a block to merge, not a replacement.

**Optional but recommended:** to make "must accept the TOS to chat" binding on the server and not just in the page, add this to the `.write` (or `.validate`) of your `messages/$key/$msg` rule:

```
&& (root.child('tosAccepted/'+root.child('uidToId/'+auth.uid).val()+'/v').val() >= 1
    || root.child('owners/'+root.child('uidToId/'+auth.uid).val()).val() === 1)
```

## 3. How it behaves
- **Not accepted / declined:** can use everything, can read chats, can't send or edit messages. A banner explains why and offers the TOS.
- **Accept:** username, account ID, IP, time and browser go to your Discord webhook. A scrambled IP fingerprint is saved on the account (`tosAccepted/<id>/h`).
- **Decline:** the browser makes **no request at all**, nothing is logged. The choice is remembered for that browser tab only.
- **Ban an account:** its saved fingerprint goes into `ipBans/`, so new accounts on that network can't chat. Unbanning the account lifts the IP ban it caused.
- **Manual IP ban:** Settings > Moderation (owners) > "IP ban". Paste the IP from Discord. Unban works the same way.
- **VPN / proxy / Tor:** chat is blocked for accepted users whose IP is flagged. Re-checked every 5 minutes and on send.
- **Owners** are exempt from the chat lock.

## 4. Settings in `js/core/config.js`
- `TOS_VERSION`: bump it to make everyone re-accept after editing the TOS text (`TOS_SECTIONS` in `js/moderation/tos-gate.js`).
- `API_FAIL_CLOSED`: `false` (default) lets people chat if the IP/VPN service can't be reached. `true` blocks chat instead.
- `IP_BAN_FULL_LOCK`: `false` (default) = IP-banned networks can't chat. `true` = locked out of the whole menu like a banned account.

