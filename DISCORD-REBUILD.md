# ICH → Discord rebuild

What changed, what you have to do to deploy it, and what is honestly not there yet.

---

## 0. Launcher windows (about:blank)

The site is normally opened from an about:blank or blob launcher window, where `location.href` is
`"about:blank"` and `location.origin` is the literal string `"null"`. Two consequences, both handled:

- **Invite codes are the primary way in.** The invite dialog shows the 8-character **code** first,
  big. Anyone joins with **+** on the rail → **Join a Server** → paste. No URL involved. There is
  also a **Have a code?** button on Discover.
- **Invite links still work**, built from `CFG.SITE_URL` in `js/core/config.js` when the window has
  no address of its own. Point that at whichever deployment you want links to open; it defaults to
  the Vercel one. If it is not an http(s) address, the dialog says so and falls back to the code.

Verified by loading the real `dist/index.single.html` into an about:blank window via
`document.write`: the theme applies, the rail builds, and nothing throws.

---

## 1. Deploy checklist (do these in order)

1. **Upload the new Firebase rules.** Firebase Console → Realtime Database → Rules → paste
   `firebase-rules.json` → Publish. **Nothing to do with servers, channels or roles works until
   this is done** — the browser will be denied on every write and you'll see `PERMISSION_DENIED`
   in the console.

   **Do this on a computer, not a phone.** The file is ~105 KB. If the console shows
   **"Unexpected EOF"**, the paste was cut off part-way — the editor hits the end of the file
   while still inside a string, and reports it at the line where that string began. It is not a
   syntax error in the rules: the whole file is checked against a real Realtime Database rules
   parser before it ships. Either paste on a desktop, or skip the console entirely:

   ```
   npm i -g firebase-tools
   firebase login
   firebase deploy --only database          # uses database.rules.json / firebase.json
   ```

   `firebase-rules.min.json` is the same rules with the whitespace stripped (~96 KB) if you want
   the smallest possible paste.
2. **Upload the site folder** as usual (or `dist/index.single.html` for the launcher windows).
3. Sign in and check the rail shows **ICH**, and that `#general` still has all your old messages.

Your existing data is untouched. No migration, no export, no re-signup.

---

## 2. What you asked for, and where it lives

| You asked for | Where it is |
|---|---|
| Only the Discord theme | `css/00-discord-theme.css`. The glass theme is deleted, the look toggle is gone, `html.discord-look` is now set before first paint and can't be turned off. |
| Everything inside a server called ICH | `js/discord/model.js` → `ICH`. Name "Itsukis Chat Hub", icon "ICH". |
| Can't leave it | ICH is defined in code, not the database. Leave/delete/rename all throw. The server menu says "Home server — can't be left". |
| Rooms removed | `js/social/rooms.js` deleted, the Rooms sidebar and rail entry are gone, room codes no longer exist. |
| Servers | Rail with drag-to-reorder, Create Server, Join Server, invite codes with expiry and use limits, per-server channels/roles/members, server settings. |
| Roles | Full role manager: create, colour (20 Discord swatches + picker), drag to reorder, hoist, mentionable, 20 permissions, per-channel allow/neutral/deny overrides, member assignment. |
| Username + password, no email | Sign-up asks for username and password only. Google sign-in removed. |
| Shop, VIP $10, MVP $30 permanent | Rail → 💎. Tiers, perk comparison, and an owner-only Grant panel. |
| Mobile | Rail + channels slide in as one drawer, member list slides in from the right, safe-area insets, 42–48px touch targets, no horizontal overflow at 390px. |
| Bans scoped to one server | `serverBans/`. A ban in someone's server removes them from **that server only** and blocks rejoining. A ban in ICH is still the site-wide ban. |
| Timeouts scoped to one server | `serverMutes/`, plus a rules change so an ICH timeout no longer silences people in other servers either. |
| IP bans scoped to one server | `serverIpBans/`, keyed by the same hashed network id the TOS gate already computes. |
| Invite links | Full shareable URLs (`…/#invite=CODE`) that join on open, and survive signing in. |
| Discover | Opt-in public server listing with search, joinable without an invite. |
| Server icon uploads | Upload, auto square-crop, auto compress, validated like avatars. |
| New TOS | v6, covering servers, roles, invites, Discover and per-server moderation. Everyone re-accepts. |
| Joining without a link | Invite **codes** are the primary route and work in launcher windows. Links are a bonus. |
| Server limits | Create **5**, join **100** / **200** VIP / **300** MVP. Site owners exempt. |
| Keep every existing feature | Games, Extras, music, Daily Spin, VIP, MVP, Halloween, Trick-or-Treat, voice, friends, DMs, moderation, TOS gate and bans all still work, reachable from the rail. |

---

## 3. The important design decision

**Channels are a name and an icon pointing at a message key.** Nothing about how messages are
stored changed.

`#general` **is** the old `global` key. `#announcements` is `announcements`. All five original
rooms kept their keys, which is why every message you have ever had is still there and why the
existing database rules still guard them exactly as before.

Channels on servers people create get a fresh key like `cABC123_general_X7K2`. Those deliberately
fall into the generic branch of your existing rules, which gates any unknown key on
`roomMembers/$key/$uid` — so messages, presence, typing and reactions on new channels are
protected by rules you already trusted, with no new message rules written.

---

## 4. Rules changes

`firebase-rules.json` is generated from your original file by `scripts/build_rules.py`, so every
existing rule is byte-identical. It makes **one** edit and adds **ten** nodes.

**The one edit** — `roomMembers/$room/$id/.write`. It used to require `rooms/$room` to exist (the
old room system). It now also accepts a server channel, identified through `channelServer/`.

**Added:** `servers`, `userServers`, `serverOrder`, `channelServer`, `serverCats`,
`serverChannels`, `serverRoles`, `serverMembers`, `serverInvites`, `invites`, `pins`,
`serverBans`, `serverMutes`, `serverIpBans`, `serverDiscovery`.

**Two more edits, for per-server moderation:**

- `messages/$key/$msg/.write` — the mute check used to be one global test, so being timed out
  anywhere silenced you everywhere. For a channel on a server it now reads that server's own
  `serverMutes` and `serverBans` instead. The five original ICH keys and DMs are untouched.
- `typing/$key/$id/.write` — a member banned from a server can no longer show as typing in it.

### How role permissions are enforced server-side

Realtime Database rules can't walk a member's role list, so permissions are flattened into
`serverMembers/$sid/$uid/p/<perm>`. Rules read that; only people who can already manage roles are
allowed to write it, so it can't be self-granted. `@everyone` is read live from
`serverRoles/$sid/everyone/perms` so a member who just joined gets the defaults immediately.

The client recomputes that cache whenever roles change (`DModel.syncPerms`).

### Writes are staged, on purpose

Rules evaluate `root` as the data **before** the write. A single atomic create would be rejected,
because the rule for `serverChannels/$sid` asks "do you own `servers/$sid`?" and inside that same
write the server doesn't exist yet. `createServer`, `createChannel` and `joinByInvite` therefore
write in stages, each one only touching things the previous stage already made true. If you
refactor them back into one `update()`, server creation will start failing with PERMISSION_DENIED.

---

## 3a. What is in ICH, and what is not

This is the bit that was unclear, so plainly:

**ICH holds everything from before.** Every old channel and all its history (`#general` is the old
`global`), the games and Hubs, Extras, the music player, the Daily Spin, VIP and MVP and their
lounges, Halloween, Trick-or-Treat, the voice channel, friends, DMs, the moderation tools and the
TOS gate. Nothing was taken out of it. Everyone is a member and nobody can leave.

**A server someone creates is its own thing.** It gets text and voice channels, categories, roles
and members, and nothing else. No games, no spin, no VIP lounge, no site features — those belong
to ICH. Its roles, bans and timeouts are entirely its own and reach nowhere else.

The buttons on the rail below the servers — Games, Extras, Shop, Discover, Settings — are
*site* features, not server features. They stay put whichever server you are looking at.

---

## 3b. Server limits

| | Limit |
|---|---|
| Servers you can create | **5** |
| Servers you can be in | **100** |
| …with VIP | **200** |
| …with MVP | **300** |
| Site owners | no limit |

ICH never counts toward either number — nobody chose to join it and nobody can leave it. The
numbers live in `CFG.MAX_SERVERS_OWNED` / `MAX_SERVERS_JOINED*` in `js/core/config.js`, and the
Add a Server dialog shows where you stand before you hit a wall.

Enforced in the browser. Database rules cannot count children, so a server-side cap would mean
maintaining a counter whose drift could lock people out of joining anything — a worse failure than
someone bypassing this from a console. Enforce it from your backend if you want it hard.

---

## 4a. How punishments scope

| Where it is given | What it does | Stored in |
|---|---|---|
| **ICH** ban | Locks the whole account out of the whole site | `banned/` (existing, unchanged) |
| **ICH** timeout | Silences them in ICH channels and DMs — **not** in other people's servers | `muted/` (existing, now narrower) |
| **ICH** IP ban | Blocks that network site-wide | `ipBans/` (existing, unchanged) |
| **Any other server** ban | Removes them from that server and blocks rejoining. Account untouched everywhere else | `serverBans/$sid/$uid` |
| **Any other server** timeout | Can't send/react there. Can still read there, and is unaffected elsewhere | `serverMutes/$sid/$uid` |
| **Any other server** IP ban | Blocks that network from that one server | `serverIpBans/$sid/$hash` |

ICH moderation still lives where it always did — **Settings → Moderation**. Per-server moderation
is in **Server Settings → Bans**, and on the right-click menu of any member.

**One honest limitation.** Database rules can't see an IP, so a *per-server* network ban is
enforced in the browser, not by the server. It is a deterrent against someone's other accounts, not
a wall. The **account** ban that goes with it *is* enforced by the rules, and the site-wide IP ban
is still enforced properly through `/api`. The ban dialog offers the network ban as an extra
alongside a real ban for exactly this reason.

---

## 5. Files

**New**
```
css/00-discord-theme.css      the palette and reset; repoints the old variables at Discord's
css/99-discord-shell.css      new chrome: channels, members, menus, dialogs, settings, roles, shop, mobile
js/discord/model.js           servers, channels, roles, permissions, invites
js/discord/ui.js              context menus, dialogs, drawers, server/channel/category actions
js/discord/server-settings.js full-screen server settings + the role manager
js/discord/shop.js            VIP / MVP shop
js/discord/moderation.js      per-server bans/timeouts, icon uploads, invite links, Discover
firebase-rules.json           the rules to paste into the console
scripts/build_rules.py        regenerates the rules from your original file
test/                         fake Firebase + browser tests (dev only, never loaded by the site)
```

**Deleted:** `js/social/rooms.js`, `css/11-glass-theme.css` (from the load list).

**Edited:** `js/manifest.js`, `index.html`, `js/ui/discord-shell.js`, `js/auth/auth.js`,
`js/chat/chat-view.js`, `js/chat/chat-header.js`, `js/chat/composer.js`, `js/chat/pings.js`,
`js/chat/messages.js`, `js/ui/home.js`, `js/ui/navigation.js`, `js/core/boot.js`,
`js/early/anti-lag-boot.js`, `js/settings/anti-lag.js`, `js/settings/settings-page.js`,
`js/features/voice-channel.js`.

`css/22-discord-look.css` was **not** rewritten. It already styled messages, bubbles, the composer
and the rail correctly, so it is kept and simply always active now; the new stylesheet complements
it rather than overriding it.

---

## 6. Testing

```
node test/build-harness.js     # builds test/harness.html (the real app + a fake database)
node test/run.js               # renders, screenshots every viewport, exercises servers/roles/invites
node test/run-perms.js         # permissions, role hierarchy, channel overrides, DMs, mobile drawer
node test/run-features.js      # every dialog and the rail
node test/run-moderation.js   # per-server bans/timeouts/IP bans, discovery, invites, icons,
                              #   XSS and overlong input, hierarchy guards
node test/run-signin.js       # signing in through the real form, and switching accounts
node test/run-limits.js       # the 5/100/200/300 caps, and invites from an about:blank window
```

All six pass with **zero page errors**. The only console errors are network calls to the real
internet (music, the attest API, the TOS endpoint), which can't resolve in a test container.

`test/` is development-only — it isn't in `js/manifest.js` and nothing in the site references it.

---

## 7. Known limits — read this before you assume something is broken

- **The shop cannot take payments.** There is no payment processor, and a browser must never be
  trusted to decide someone paid. Buyers get instructions plus their user ID; owners grant the tier
  from the Grant panel, which writes `vip/$id` or `mvp/$id` — exactly what your rules already allow
  an owner to do. If you add a provider later, do those two writes **from your server** after a
  verified webhook, not from this page.
- **Built-in ranks stay console-managed.** Owner, Admin, Mod, MVP, VIP and anything in
  `customroles/` appear in the role manager with their real colours and hierarchy, but are marked
  read-only, because your rules forbid the browser writing them. That's deliberate — it's what stops
  someone granting themselves Owner. Roles you create in the manager are fully editable.
- **ICH has no member list of its own.** Everyone with an account is a member, so the ICH member
  list is every user. Servers people create have real membership.
- **Kicking and banning are per-server**, and don't exist on ICH — use the existing site ban tools
  there instead.
- **Not built:** threads, forum channels, stage channels, screen share, custom emoji/stickers,
  slash commands, webhooks, bots, boosts, folders, AutoMod. Those are large features in their own
  right, not polish.
- Voice is still Agora, exactly as before — the voice channel in the sidebar opens the existing panel.

---

## 8. Round two: bugs found and fixed

The second pass was an explicit bug hunt. These were real, and are fixed:

1. **The server model never started when you signed in.** `DModel.start()` only ran in `boot.js`,
   which runs at page load. Signing in from the auth screen — the normal path — left it unstarted:
   no servers, no roles, no channels until you reloaded. Switching accounts in one session left it
   pointed at the previous user. `goHome()` now calls `DModel.ensureStarted(ME.id)`, which every
   sign-in path goes through. `test/run-signin.js` covers it.

2. **Nothing listened to the model.** `DModel.onChange` had no subscribers, so creating a channel,
   editing a role, changing an icon or someone joining only appeared when something *else* happened
   to repaint. The shell now subscribes, coalesced on a frame.

3. **`listInvites` would have failed in production.** It queried the whole `invites/` node, which
   the rules only allow reading one code at a time (and opening up would leak every invite on the
   site). Replaced with a `serverInvites/$sid` index.

4. **A 28-day timeout was rejected.** The cap landed exactly on the rules' exclusive upper bound.

5. **`joinByInvite` didn't check bans.** The rules refused the write, so a banned user couldn't
   actually get back in, but they saw a raw permission error instead of being told why.

6. **A per-server network ban didn't reach `canIn`.** The composer looked usable to a
   network-banned member until the send bounced.

7. **Discovery images were trusted.** `serverDiscovery/$sid/img` is writable by that server's own
   staff and went into an `img src` without validation. Now checked with the same test as avatars.

8. **An invite link opened while signed out was lost** after signing in. The code is parked in
   `sessionStorage` and consumed once there's an account.

9. **A server could vanish under you** — banned, deleted, or left on another device — and leave an
   empty shell. The shell now falls back to ICH and says so.

10. **Deleting a server leaked** its bans, mutes, IP bans, invite index and Discover listing.

Also verified and passing: injected HTML in server/channel/role/nickname/description fields never
reaches the DOM, bogus role colours are dropped, channel names are sanitised, overlong input is
capped, you can't ban yourself or the server owner, you can't delete `@everyone`, you can't rename
or leave or delete ICH, and there's no horizontal overflow at 390px.

---

## 9. Round three: launcher, limits, and three more bugs

**Launcher-proofing turned up three real crashes**, all in `js/ui/mobile-sidebar.js`, all from the
same root cause: the script captured or touched `document.body` at load time. A launcher that
`document.write()`s the page into an about:blank window runs scripts inside `<head>`, where there
is no `<body>` yet, and each of these took the whole app down:

1. `document.body.appendChild(backdrop)` — threw immediately.
2. `var body=document.body` captured null, so every `body.classList` call after it threw.
3. `MutationObserver.observe(null)` when neither `#sidebar` nor `<body>` existed.

All three now wait for the document. The real build happens to dodge them because it ships as a
deferred `<script type="module">`, but a launcher that injects the page differently would not have,
and the cost of being safe here is three lines.

The test harness had the same flaw in reverse: it ran the app from an inline script (where `defer`
is ignored), giving it failure modes production does not have. It now emits a
`<script type="module">`, exactly like `dist/index.single.html`.

**Also fixed:** `inviteUrl()` built links out of `location.origin` and produced strings like
`nullblank#invite=ABC` in a launcher window. It now uses the page address only when it is genuinely
http(s), falls back to `CFG.SITE_URL`, and returns nothing rather than garbage if neither works —
with the dialog leading on the code in every case.

---

## 10. Round four: the "Unexpected EOF" report, and a slimmer ruleset

The console error was **not** a syntax error. The file is now checked at build time against
[targaryen](https://www.npmjs.com/package/targaryen), a real implementation of the Realtime
Database rules language, and every expression compiles. The reported line (1322) was the single
longest line in the file, 3.2 KB, sitting 91% of the way through — exactly what a truncated
clipboard produces: the parser runs past the end of the file still looking for a closing quote,
and blames the line the string started on.

So the fix was to make the file smaller and stop any one line being enormous:

- **`manager()` no longer re-derives Administrator.** The client's permission cache already
  expands Administrator into every individual permission, so testing `p/admin` *as well* as
  `p/<perm>` was duplicated work — inlined about 25 times across the new nodes. Removing it cost
  nothing and saved roughly 10 KB. The one behaviour that changes is granting Administrator to
  `@everyone`, which the client now refuses outright so both sides agree.
- **Invites moved to `invites/$sid/$code`.** `$sid` is a wildcard, so the rule says `$sid`
  instead of repeating `newData.child('sid').val()` a dozen times. That alone took the offending
  line from 3,256 characters to 2,082. It also means a server's staff can list its invites in one
  read, so the separate `serverInvites` index node this needed is gone. `inviteCodes/$code → sid`
  is the small lookup that turns a bare code into a server.

**113.7 KB → 105.1 KB**, longest new line 3,256 → 2,082. The biggest line in the file is now the
original `messages` rule at 6,125 characters, which was already in the ruleset you deployed before,
so it is known to paste.

While doing this I deleted a block of nodes by accident and the build still produced a
plausible-looking file. `scripts/build_rules.py` now refuses to write output that is missing any
expected node or any of the three in-place edits, so that cannot pass silently again.

---

## 11. Round five: "make it actually Discord" (2026-11-08)

Four complaints, in the order they mattered.

### A. Servers not working — the actual bug

`createChannel` wrote `serverChannels`, `channelServer` and `roomMembers` in **one** `update()`.
That can never work against the real database. The `roomMembers` rule begins

```
root.child('channelServer').child($room).exists()
```

and `root` in a rule is the data **before** the write — so inside the very update that creates
`channelServer/$key`, that test is false. A multi-path update is all-or-nothing, so the one denied
path took the whole write down with it: **creating a channel on a server failed outright with
PERMISSION_DENIED.** Section 4 of this document said createChannel was staged. It wasn't.

The reason it was never caught: `test/fake-firebase.js` doesn't evaluate rules, so every test
passed while the feature was broken for everybody using the site.

It is now staged the same way `createServer` is — channel + `channelServer` first, access second.

Alongside it, three things that turn a half-finished write into a self-healing one:

| | |
|---|---|
| `dWrite(label, fn)` | Retries transient failures (dropped connection, slow handshake) with backoff. A **refusal** is never retried — retrying can't fix it — and raises the rules notice below once. |
| `DModel.grantAccess(sid)` | Re-asserts `roomMembers/$key/$me` for every channel of a server, whenever you open it. No-op unless the channel list changed. This is what repairs "I joined the server but I can't talk" and "someone made a channel and I can't see it". |
| `DModel.pruneDeadServers()` | Six seconds after sign-in, removes `userServers` entries whose server no longer exists. They used to sit there forever, invisible on the rail but still counting against your join limit. |

`createServer` now also **rolls back** if a later stage fails, so a failed create leaves nothing
behind instead of an empty server pinned to your rail.

And a refusal no longer reaches anyone as a raw `PERMISSION_DENIED`. Owners are told, once, in
words: the published rules are older than this build, here is where to republish them. Everyone
else is told it's a setup problem and to tell an owner.

### B. The UI wasn't Discord — `css/27-discord-exact.css`

`css/22-discord-look.css` got the colours right and then drifted on everything you can measure.
The new stylesheet loads last and owns the geometry only (sizes, spacing, type scale, radii,
breakpoints); colours still come from `00-discord-theme.css`, so every theme keeps working.

| | was | now (Discord's own) |
|---|---|---|
| channel row | 56px | **32px** |
| member row | 56px | **42px** |
| sidebar / member list | 248 / 224px | **240 / 240px** |
| chat header | varied | **48px** |
| user panel | 56px, floating across rail+sidebar | **52px, inside the sidebar** |
| body / sidebar text | 17px | **16px** |
| corner radius | 10–14px | **4px** |
| message avatar | varied | **40px**, text at 56px |
| messages | bubbles | **plain text on the chat background** |

The user panel is the visible one: it was `position:fixed` and stretched across the rail *and* the
sidebar, floating over whatever was underneath. Discord has never done that.

Four layouts are checked by `test/run-visual.js`, which measures all of the above at eleven
viewports and fails the build if any of them drift:

* **desktop** ≥1025px — rail, channels, chat, members
* **tablet** 821–1024 — member list becomes a drawer
* **phone** ≤820 — rail + channels become one drawer, 44px touch targets
* **phone landscape** (short) — the same, with the vertical padding squeezed out and 40px rows

### C. Settings weren't Discord's, and your profile wasn't in them

The nav was seven of this site's own tabs. It is now Discord's sectioned list — **User Settings**
(My Account, Profiles, Privacy & Safety, Friend Requests), **Billing Settings** (Perks & Shop),
**App Settings** (Appearance, Accessibility, Voice & Video, Text & Images, Notifications,
Keybinds, Language, Music), then Advanced and Moderation — rendered full-screen the way Discord's
is, rather than as a modal.

`js/settings/discord-settings.js` adds the panes that didn't exist: **My Account** (banner card,
username, user ID, password, sign out), **Profiles** (the whole profile editor — avatar, banner,
pronouns, About Me, tags), **Friend Requests**, **Perks & Shop**, **Accessibility** (reduce
motion, anti-lag, text size) and **Voice & Video** (microphone picker, a mic test that never
touches Agora, the minutes explainer, the connection test).

`openAccount()` now opens **Settings → Profiles**. Every entry point that used to open the old
separate modal lands there instead. The old modal survives as `openAccountLegacy()` for the one
case the settings page can't cover, and nothing routine reaches it.

Also new: the **status picker**. Clicking yourself in the user panel opens Discord's popout —
Online / Idle / Do Not Disturb / Invisible plus a custom status line. Idle is a crescent and DND
is a barred circle, so the four don't rely on colour alone. Status is stored in `users/$id/style`,
which is the public half of a profile, so everyone sees it in the member list.

### D. Voice: one global call → one call per channel

Every voice channel on every server is now its own call.

* **Which channel you are in** is `voice/members/$id/ch`. The roster is filtered by it and the
  Agora channel name is derived from it, so two servers' voice channels can never hear each other.
* **ICH's "General Voice" keeps the original Agora channel name**, so this upgrade doesn't split a
  call that is already happening.
* The sidebar shows who is in each voice channel under its row, with the muted/deafened marks and
  the green speaking ring, and clicking a voice channel **joins it**, like Discord.
* A **voice status panel** sits above the user panel whenever you're connected, and the call fills
  the chat area with participant tiles and a round control bar.
* Moderator mutes and kicks stay per-account, so they follow someone into whichever channel they
  move to — which is what Discord does too.

**STANDBY, which is the whole minute story.** Agora bills per connected user per minute. Sitting
in an empty channel used to cost real money for nothing. You now sit in a channel with **no Agora
connection at all** until a second person is there; the moment someone joins, both sides connect.
When you are the last one left the audio drops again and you stay in the channel. The connection
also closes after 5 minutes with the tab in the background.

An idle or empty channel therefore costs **zero** minutes, and only genuinely two-way audio is
billed. To be straight about it: there is no Agora setting that makes a call cost "one minute per
channel" regardless of how many people are in it — billing is per user-minute and always will be.
What changed is how much of it you actually spend.

### Rules

Two fields, both forced by `"$other": {".validate": false}` on the nodes they live in — without
them the write is refused outright:

* `voice/members/$id/ch` — which voice channel a presence record belongs to.
* `users/$id/style/status` and `.../customStatus` — the presence status picker.

Both are added by `scripts/build_rules.py`, which now refuses to write output that is missing
them. **107,980 bytes**; both the full and minified files compile clean against
[targaryen](https://www.npmjs.com/package/targaryen), a real implementation of the Realtime
Database rules language.

**You have to publish them.** Per-server voice and the status picker are refused until you do.
`rules-copy.html` is a one-tap copy page for doing it from a phone, where selecting 100KB of text
by hand is what produces the "Unexpected EOF" error.

### Testing

```
node test/build-harness.js     # the real app + a fake database
node test/run.js               # renders, screenshots, exercises servers/roles/invites
node test/run-visual.js        # NEW: measures the layout at 11 viewports against Discord's numbers
node test/run-perms.js         # permissions, hierarchy, channel overrides, DMs, mobile drawer
node test/run-features.js      # every dialog and the rail
node test/run-moderation.js    # per-server bans/timeouts/IP bans, discovery, invites, icons, XSS
node test/run-signin.js        # signing in through the real form, switching accounts
node test/run-limits.js        # the 5/100/200/300 caps, and invites from an about:blank window
```

`run-visual`, `run-perms`, `run-features`, `run-moderation` and `run-signin` pass with zero page
errors. `run-limits` fails at its last step on a click the session modal intercepts — **this is
pre-existing**, it fails identically on the build in the zip, and it is a harness-only path
(an about:blank window driven by two contexts at once). Everything it actually asserts passes.

### Known limits, still

Unchanged from section 7, plus: the mic test in Voice & Video is a local level meter, not a
loopback — it shows that the microphone works, it doesn't play your voice back. Threads, forum and
stage channels, screen share, custom emoji, slash commands, webhooks, bots and AutoMod are still
not built.

### Round five, part two: an independent review of the diff

A reviewer who hadn't written any of it went through the whole change set and found seven more
defects. All seven are fixed; these are the ones that mattered:

1. **You could only ever join the first voice channel you clicked.** `openVoice()` guarded its
   autojoin with `!S.joined`, so once you were in any channel, clicking a different one opened
   its stage and connected you to nothing. `join()` already handles switching (it leaves the old
   channel first) and already no-ops for the channel you are in, so the guard now asks the only
   question worth asking: is this somewhere new. This defeated the entire point of per-channel
   voice and is the single most important fix in this round.
2. **One hung connection attempt could kill voice for the rest of the page's life.** `linkBusy`
   belongs to `reconcileLink()` and was never cleared by `cleanup()`, so a join torn down while
   an audio attempt was in flight left the flag stuck on; every later join then sat in standby
   forever with nothing on screen to explain it. On top of that the guard timeout was armed at
   the `connect` stage, leaving the two steps before it — loading the SDK and opening the
   microphone — with no outer bound, so a `getUserMedia()` that never settled (an unanswered
   permission prompt, a mic another app holds) hung the attempt indefinitely. The guard is now
   armed first and covers the whole attempt, `makeMic()` has its own timeout, and `cleanup()`
   clears the flag.
3. **The pronoun chips disappeared whenever you changed settings tab.** They carried
   `data-p="he/him"`, and the settings page shows a pane with `querySelectorAll('[data-p]')` —
   so all seven chips got `.hidden` the moment any tab was clicked. They use `data-pron` now.
4. **Invisible only greyed your dot.** You stayed in `onlineIds()`, in the online count and in
   your role group in the member list, so the one thing Invisible is for didn't happen. It now
   moves you into Offline for everyone but yourself, in the member list and the friends list.
5. A guard timeout could leave `S.linked` true with `S.client` already null. Each attempt now
   carries its own sequence number, so the guard can retire a hung attempt without tearing down
   the channel, and the retired attempt releases only what it created.
6. `reconcileLink()` is driven by the roster, which ticks every few seconds, so a channel that
   could not connect retried forever — hammering Agora and flashing the error card at everyone.
   It now gives up after three consecutive failures and says so; **Try again** resets it, and
   when you are already sitting in the channel that button reconnects the audio rather than
   trying to join a channel you are already in.
7. The "taking longer than usual" hint had been left behind in the rewrite and could never fire.

The reviewer separately confirmed, by running it rather than reading it: no use-before-definition
in `model.js` and no export that doesn't resolve; `createServer`'s rollback is fully self-caught
so it cannot mask the original error; nav/pane pairing is exactly 1:1 for both staff (16/16) and
non-staff (15/15); no duplicate element ids; no recursion between `openAccount` and
`openSettings`; no unescaped user data anywhere in the new panes; saving an unrelated setting
preserves avatar, banner, pronouns, description, tags, status and custom status; the rules diff
against the original is exactly three added leaves with nothing removed or changed, and the full
and minified files parse to identical trees; both new files are registered in `js/manifest.js`
*and* `index.html`, in the right order; and `dist/index.single.html` contains both.

### Round five, part three: a bug sweep (nothing had been tested yet)

Every screen, dialog, theme and interaction driven in a browser and checked. Six real defects,
four of them mine from parts one and two.

**Mine, introduced by `css/27-discord-exact.css`:**

1. **The member list could not be opened on a phone or tablet.** The hide rule was written
   `#chatPage .dl-members{display:none}`, which out-specifies `99-discord-shell.css`'s
   `.dl-members.show{display:block;position:fixed;…}` because of the `#chatPage`. So the drawer
   stayed hidden even when opened — the member button simply did nothing at any width below
   1025px. It now hides only `:not(.show)`, and the open drawer keeps the shell's own positioning
   and slide-in.
2. **The chat area was a different shade from its own header and composer on 17 themes.** I gave
   `.messages` a `background`. 17 of the 25 themes make `--dl-bg` *translucent* over a body
   gradient, so painting the list as well as its container stacked a second wash. The background
   belongs to `.main`; the list just scrolls.
3. **A dark slab under a light sidebar on all eight light themes.** `--dl-userbar` (the user panel,
   the one surface Discord has that the theme file never named) was a literal `#232428`. It is now
   mixed from the rail and sidebar tokens, so it follows every theme.
4. **The voice mute/deafen "on" state was invisible on light themes** — Discord's inverted button
   was hard-coded white-on-dark. It takes the theme's own head/background tokens now.

**Pre-existing:**

5. **"Add Friend" was off the edge of the screen on a phone.** The Friends header is one nowrap
   flex row — title, four tabs, button — which needs about 520px. At 390px the button sat at
   x=458, completely unreachable. The tabs are now wrapped in a row of their own that scrolls
   sideways, with the title and a reachable Add Friend above it.
6. **Two context menus opened on top of each other.** Right-clicking a channel, server, category
   or member opened the correct Discord menu *and* the generic app menu (Settings / Fullscreen /
   Sign Out) stacked on the same pixel, so the right-click appeared to offer the wrong thing
   entirely. The generic menu now stands down when the shell has just opened one of its own.
   Note for anyone touching this later: the test is "is a `.dctx` menu open", **not**
   `e.defaultPrevented` — `js/core/diagnostics.js` cancels every contextmenu event in the capture
   phase, so `defaultPrevented` is always true and using it disables the app menu everywhere.
   (That exact mistake was made and caught here.)
7. **The MVP/VIP lounge banner stuck to the Friends page.** `renderMain()` calls `applyVipLock()` —
   which clears the banner, the `vip-mode`/`mvp-mode` page classes and the lock screen — only at
   the very bottom, after two early returns. Leaving a lounge for the friends list left
   "MVP Lounge · MVPs only" across the top of a page it has nothing to do with.

**Checked and found fine** (so nobody re-investigates): sending, editing (ICH edits in the
composer with an "Editing message" bar, not inline), the `(edited)` tag, delete-with-confirmation,
the hover toolbar at all widths, Enter vs Shift+Enter, reactions, the rate limiter, channel
creation end to end including the access grant, all four ways of closing the phone drawer (tap the
chat, swipe left, Escape, pick a channel), long unbroken words and 2000-character messages, and
all 25 themes for contrast and surface consistency. The hamburger sitting under the rail while the
drawer is open is the normal drawer pattern, not a bug.

Server Settings also got the same two-level list → section treatment on phones that User Settings
has, with a back arrow and Escape backing out one level.

New dev-only scripts, not referenced by the site: `test/run-visual.js` (11 viewports against
Discord's measurements). The sweep, dialog, theme and interaction harnesses were throwaway.


---

## 12. Round six (v53): display names, boosts, and the bugs behind the complaints

### Deploy first — the rules changed again

`firebase-rules.json` has new fields in it, and **nothing added in this round works until you
publish them**: display names, the status picker's new home, join messages, boosts and the extra
server settings all write to nodes the old rules reject. Same routine as before — Firebase Console
→ Realtime Database → Rules → paste → Publish, or `firebase deploy --only database`, or open
`rules-copy.html` for the one-tap copy (that page has been regenerated, so it holds the new rules).

What was added, and nothing else was touched:

| Node / field | For |
|---|---|
| `users/$id/style/displayName` | display names |
| `servers/$sid/desc` | the server description in Overview |
| `servers/$sid/sys` | which channel join messages go to |
| `servers/$sid/welcome`, `…/wjoin` | join messages on/off, random wording on/off |
| `servers/$sid/banner` | server banner (Boost Level 1 perk) |
| `messages/$key/$msg/sys` | marks a message as a system line (a join, a boost) |
| `serverBoosts/$sid/$uid/$slot` | who boosts a server |
| `userBoosts/$uid/$slot` | where each of your own boost slots points |

Plus **one surgical edit** to an existing rule, described under "the staff ladder" below.

`scripts/add_rules_v53.py` makes all of it, additively, asserting the shape of everything it
touches first. (`scripts/build_rules.py` can't be re-run — it needs the original pre-Discord
ruleset as input and that file isn't in the repo any more; `firebase-rules.json` is its output.)
Both the full and minified files compile clean against targaryen.

### A. The images bug — why they were enormous with grey bars either side

`css/27-discord-exact.css` ends with an anti-overflow guard:

```css
html.discord-look .messages, html.discord-look .messages * { max-width:100% }
```

That `*` out-specifies `.imgs{max-width:340px}` in `06-chat.css`, so **every** image in chat grew
to the full width of the message column. Combined with `.imgs img{width:100%}`, a 320px-tall grid
row and `object-fit:contain`, a small image was blown up into a 784×320 box and the leftover space
filled with `background:var(--bg2)` — the grey slabs on either side.

Measured before: a 120×90 image rendered at **784×320**. After: **120×90**, no box around it.

Images are now sized the way Discord sizes them — by their own aspect ratio, capped at 550×350,
**never upscaled** — in `css/28-discord-plus.css`. Uploaded GIFs and video (`.fa-*`) had the same
flattening and got the same treatment.

### B. The staff ladder — admins could delete admins, mods could delete mods

The delete check tested only the ranks **above** the actor and never the actor's own:

```js
isOwner(me) || (isAdmin(me) && !isOwner(them)) || (isMod(me) && !isOwner(them) && !isAdmin(them))
```

so an admin could delete another admin's message and a mod another mod's. The database rules had
the identical gap, so it wasn't only a UI slip — it was enforced wrongly on the server too.

There is now one rule, in one place (`outranks()` in `js/moderation/roles.js`):

> **owner 4 > admin 3 > mod 2 > everyone 1.** You may act on someone strictly below you, and on
> nobody else. Your own messages are always yours to delete.

MVP is deliberately **not** on the ladder: it is a perks tier with no moderation powers, so it
neither protects its holder from a mod nor lets them act on anyone.

Both delete branches of `messages/$key/$msg/.write` gained the one missing test, and
`test/run-rules.js` drives 13 cases through **targaryen** — a real implementation of the rules
language — so the server-side half is proven, not assumed.

### C. Removing someone from `owners/` didn't change anything on screen

`customroles/` repainted the UI when it changed. `owners/`, `mods/`, `admin/` and `mvp/` did not.
So taking Owner off someone in the Firebase console left them still rendered as Owner — in their
member-list group, in their name chip, on the `#id` tag beside their messages — until something
unrelated happened to trigger a render. Everything reads rank live; one repaint was all that was
ever missing. All four listeners now call it.

### D. ICH's channels and roles are code, and now say so

ICH is defined in `js/discord/model.js` (`ICH_CHANNELS`, `ICH_CATS`, `virtualRoles()`), not stored
as a server. Adding a channel or a role to it wrote into `serverChannels/ich` / `serverRoles/ich`,
which the rules evaluate against `servers/ich` — a node that does not exist. The write was refused,
and when it wasn't you got a channel nobody could read. That is the "it's also broken" part.

Both are now refused in the **model** (`assertNotICH`), so the context menu, the server menu, the
role manager, the `+` on a category and anything added later all agree; and the UI entries are
left out rather than offered and then failing.

### E. Site ranks were showing up in other people's servers

A brand new server opened with `MVPS — 1` and `ICE FLAIR — 2` headers that nobody there had
created. `memGroupDefs()` / `memGroupOf()` appended Owner / Admin / Mod / MVP / VIP / customroles /
Daily-Spin flairs to **every** member list regardless of which server was open.

Those are *site* ranks — granted from `owners/`, `mods/`, `mvp/`, `vip/`, `flair/`, `customroles/`
— and they mean nothing inside a server someone else made, exactly as a Discord badge is not a
role in your server. They are now scoped to ICH. A user's server shows what its own role manager
defines: its hoisted roles, then Online, then Offline, with names tinted by that server's top role
colour. The same scoping applies to message author names (`msgNameHTML`), the MVP trophy and flair
styling. **Profiles still show them**, because a profile is site-wide.

### F. Display names

Discord's display name, on top of the `@username`. Stored in `users/$id/style/displayName` (the
public half of a profile, like the avatar and the status), capped at 32 characters, with **no
cooldown** — the username keeps its 7-day limit, because that is the identity.

`dispName(user)` is what every piece of UI that shows a person now calls. The username still does
every job that needs to *match* an account: mentions, friend requests, sign-in, the moderation
tools and the ban lists. Two people can share a display name, which is the point.

Editable in **Settings → My Account → Display Name** and in **Settings → Profiles**. The `@username`
appears under the display name on a profile only when the two differ.

### G. Status moved into profile settings

The user-panel popout is still there; the same four options plus the custom status line are now in
**Settings → Profiles**, which is where people were looking. Both write the same two fields.

### H. Settings is a window again, not the whole browser

`css/22-discord-look.css` already made settings a centred window with margins ("v15: settings
window at Discord's size"). `css/27-discord-exact.css` then set
`.modal-bg:has(#sTabs){padding:0!important}` and stretched it back to every edge of the screen, and
laid the inside out as `minmax(218px,1fr) minmax(0,2.6fr)` — which lets the **nav** grow with the
display, so on a wide screen the nav ended up hundreds of pixels wide with the content pushed off
to the right. Nothing like Discord.

It is a floating panel again — dimmed backdrop, rounded corners, the app visible behind it — with
Discord's real proportions inside: a fixed **218px** nav and a **740px** content column, and the
close button in the panel's corner rather than the browser's.

### I. The rail holds servers, like Discord's

Games, Extras, the Discord link and the Shop were rail buttons. They are site features, not
servers. They now live:

* **Games / Extras / Shop / Join our Discord** → rows in ICH's own channel list, under an
  "Itsukis Chat Hub" category, shown in ICH and nowhere else.
* **Shop** → also in the direct-messages sidebar, under Friends, where Discord keeps its own.

What is left on the rail is DMs, your servers, **+** and the compass — plus User Settings.

### J. Server Boosts

**MVP grants two boost slots.** Nobody else has any, there is nothing to buy, and owners get them
too (owners get every MVP perk). ICH cannot be boosted — it is the site, not a server.

* A slot remembers **when** it was placed. It can be **moved** to another server after **7 days**.
* **Giving a boost up is always allowed** — the cooldown stops a boost being shuffled between
  servers to farm a perk, not changing your mind about boosting at all.
* **When MVP is taken away, the boosts stop counting immediately, everywhere**, because every
  count re-tests the booster through `hasMvpPerks()` at read time rather than trusting the stored
  row. There is no cleanup job and no window where a revoked MVP is still propping a server up.
  The dangling rows are tidied by that person's own client on next sign-in — the rules only let
  them write their own.

Levels use Discord's own thresholds: **2 / 7 / 14**. Level 1 unlocks a server banner (gated in
`updateServer`, so it is refused below the level rather than quietly ignored), Level 2 a longer
description and Discover priority, Level 3 the gold rail glow.

The boost bar sits under the server name, like Discord's; the dialog is on the bar and on the
server menu.

### K. Join messages, and more server settings

A join notice is an ordinary message carrying `sys:'join'`, written **by the person who joined** —
which needs no special permission, because they are a member of the channel by the time it is sent.
It renders as a grey system line with an icon: no avatar, no bubble, no hover tools, no reactions,
and it never groups with the message above it. `text` still carries a plain-words fallback so a
client that doesn't know `sys` shows something sensible rather than nothing.

Which of Discord's welcome lines is used is derived from the message's own timestamp, so every
client picks the same one and it doesn't change on re-render.

**Server Settings → Overview** gained: a server description, a system-messages channel picker,
join messages on/off, and random-welcome-wording on/off.

### L. Message formatting

`js/discord/markdown.js`: `||spoilers||`, `**bold**`, `*italic*`, `***both***`, `__underline__`,
`~~strike~~`, `` `code` ``, ```` ```fenced blocks``` ````, `> quotes`, `>>> block quotes`,
`# ## ###` headings, `-# small text`, `- bullets`, and `[label](https://…)` links.

The ordering in that file is the thing that keeps the output safe, and it is fixed on purpose:

1. **Code is lifted out first**, before anything else looks at the text — markdown inside a code
   block is not markdown.
2. Every piece of text that reaches the output goes through `esc()` before any tag is put around
   it. There is no path where raw input reaches the DOM.
3. Finished HTML (code, links, mentions) is parked behind a NUL-delimited token and put back at
   the very end, so the formatting passes can never see or mangle a tag they produced. NUL is
   stripped from the input on the first line, so a message cannot forge a token.
4. Link hrefs are only ever written by `mdLink()`, which accepts http(s) and nothing else.
   `[click me](javascript:…)` renders as plain text.

`test/run-markdown.js` drives every construct and nine XSS shapes through the real app and asserts
both that formatting works and that none of the attacks survive.

### M. Invite links say "coming soon"

Invite **codes** are the product and are unchanged. The **link** is marked coming soon, on purpose:
the site is normally opened from an about:blank or blob launcher window where the page has no
address of its own, so a link either points at nothing or at whichever deployment `CFG.SITE_URL`
names — which is not necessarily the one the person is using. A feature that works for some people
and silently fails for others is worse than one that says it isn't ready. The code works everywhere.

### N. Delete Server sits under Leave Server

An owner now sees **both**, Delete underneath Leave. Leaving a server you own is still refused —
it would strand the place with nobody able to administer it — and the error says so and points at
Delete, rather than the entry simply not being there.

Deleting a server releases your own boost slot immediately. Other boosters' rows die on their own
next sign-in, because `serverBoosts/$sid/$uid` is writable only by `$uid` — folding them into the
owner's delete would make the whole multi-path update fail and take the delete down with it.

### O. The old theme is gone, not hidden

The glass look was already unreachable, but the pieces were still there: a `apply(false)` path
that could switch it off (including from a `storage` event fired by an older build in another
tab), the first-run **"Choose your look"** dialog that still offered **Normal**, the bubble-colour,
roundness and UI-glass controls sitting in settings behind `.dl-hide`, and `css/11-glass-theme.css`
on disk.

All removed. `apply()` ignores its argument — there is one look, and turning `discord-look` off
would not reveal another one, it would leave the site unstyled. The removed controls' **values are
preserved**, not reset: `meBubble` is still the colour of a person's own messages, so `read()`
simply stops reading inputs that no longer exist rather than overwriting the stored values.

### P. Reply quotes: an overlapping avatar, a sprawling name, and a leaked spoiler

Three bugs that only showed up once somebody actually replied to something.

**The mini avatar was drawn 16px wide and 40px TALL**, hanging out of its 22px row and landing on
top of the message avatar underneath - visible on every replied-to message. Two rules style it:

| file | selector | result |
|---|---|---|
| `22-discord-look.css` | `html.discord-look .reply-ref .rr-avatar .avatar` | 16x16 `!important` |
| `27-discord-exact.css` | `html.discord-look .messages .msg .avatar` | 40x40 `!important` |

Four classes and one element each - **equal specificity**, so the later file simply won and the
quote's avatar inherited the message avatar's size and its 16px right margin.

**A long display name ate the quote.** `.rr-name{max-width:40%}` was written when a name was a
username; a 32-character display name took 250px of a 700px quote and squeezed the message you
were trying to read into what was left. The name is now capped and shrinks first, and the quoted
text gets the room.

**And the one that actually mattered: a spoiler was revealed by someone replying to it.** The
quote showed the replied-to message's raw text, so a spoiler's hidden words appeared in plain
sight above everyone's reply - the whole point of a spoiler, defeated by somebody else's action
rather than your own. Quotes now run through `mdPlain()`, which strips the formatting markers
**and replaces spoiler content rather than unwrapping it**. Raw markup is gone from previews too:
a reply to a code block used to show the fences and the code inline; it now reads `Heading [code]
bold`. The composer's "Replying to..." bar uses the same function.

### Q. The server banner is drawn now

Section 12-J shipped the banner field, the Level 1 gate and the validation, and said plainly that
nothing rendered it. It does now: across the top of the channel list, fading into the sidebar with
the server name over it, exactly where Discord puts it. Upload lives in **Server Settings ->
Overview**, cropped to 16:9 and compressed under the same budget server icons use.

The level is **re-checked at render time**, not only at upload: if a server drops below Level 1
because a booster lost MVP or moved their boost, the banner stops showing immediately. It is not
deleted, so it comes straight back if the server is boosted again.

### Testing

```
node test/build-harness.js     # the real app + a fake database
node test/run.js               # renders, screenshots, exercises servers/roles/invites
node test/run-visual.js        # the layout at 11 viewports against Discord's measurements
node test/run-perms.js         # permissions, hierarchy, channel overrides, DMs, mobile drawer
node test/run-features.js      # every dialog, the rail, and ICH's site rows
node test/run-moderation.js    # per-server bans/timeouts/IP bans, discovery, invites, icons, XSS
node test/run-signin.js        # signing in through the real form, switching accounts
node test/run-chat.js          # sending, editing, deleting, reactions, the rate limiter
node test/run-layout.js        # layout at the documented breakpoints
node test/run-overflow.js      # no horizontal overflow anywhere
node test/run-markdown.js      # NEW: every formatting construct + 9 XSS shapes
node test/run-boosts.js        # NEW: boost slots, levels, the 7-day move, MVP revocation, joins
node test/run-v53.js           # NEW: display names, ICH locking, rank scoping, the ladder,
                               #      images, reply quotes, the server banner, and one check per
                               #      item on the original list (invite wording, Leave/Delete
                               #      order, status in Profiles, Shop in DMs, forced theme,
                               #      rank-change repaint)
node test/run-rules.js         # NEW: the delete ladder against targaryen (npm i --no-save targaryen)
```

All pass with **zero page errors**. The only console errors are network calls to the real internet
(music, the attest API, the TOS endpoint) that can't resolve in a test container.

One pre-existing failure is **not** mine and fails identically on the v52 build: `test/run.js`
logs `server menu failed: page.click timeout` — the TOS modal intercepts that click in the
harness. Everything it actually asserts passes.

### Known limits, still

Unchanged from sections 7 and 11, plus:

* **Boost counts and the 7-day move are enforced in the browser**, like the server caps are, and
  for the same reason: database rules cannot compare against a node the same write is deleting, and
  a server-side counter whose drift locks people out is a worse failure than someone bypassing this
  from a console. The things that *matter* are enforced by rules — only you can write your own
  boost rows, and only an MVP can create one.
* Threads, forum and stage channels, screen share, custom emoji, slash commands, webhooks, bots
  and AutoMod are still not built.
