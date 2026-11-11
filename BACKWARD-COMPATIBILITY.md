# ICH v54.2 — backward compatibility for the 3,100 existing accounts

You asked, before anything is published, whether every existing account can still sign in, reach
its profile, send messages, reach its servers, and use the features it has today.

**Yes. Verified, not assumed.** Below is what that claim rests on, and the two things that are
*not* covered by it.

Nothing in this work deployed anything. Your live rules and your live data are exactly as you
left them.

---

## 1. The short answer

| | |
|---|---|
| Firebase Authentication accounts | **untouched.** No account created, deleted, or reset. |
| Firebase UIDs | **untouched.** No rule and no script writes to `uidToId`/`idToUid` for an existing account. |
| ICH user ids | **untouched.** The `counters/userId` ladder is unchanged. |
| `usernameLogin` mappings | **untouched.** Not read differently, not rewritten, not migrated. |
| Passwords | **untouched.** No reset, no re-registration. The new password change is opt-in and runs through Firebase's own `updatePassword`. |
| The authentication implementation | **unchanged.** Username→email alias sign-in still works exactly as written. |
| Existing user data | **nothing deleted.** The one data change on offer is additive and reversible, and you run it yourself. |

---

## 2. How this was verified

Your instruction was to compare every existing database operation against the proposed rules
before changing anything. That is what the two test programs do.

### `test/security/compat-diff.js` — the actual before/after comparison

It runs the same 230 operations twice: once against `firebase-rules.v54-original.json` (a
byte-for-byte copy of what v54 shipped) and once against the new `firebase-rules.json`. Then it
diffs the two verdicts case by case. Any operation that worked before and is refused now shows up
as a **REGRESSION**.

```
$ node test/security/compat-diff.js

  cases discovered: 230 (old run) / 230 (new run)
  minimum required: 200
  discovered : 230
  executed   : 230
  passed     : 230
  failed     : 0
  skipped    : 0

RESULT: 230 cases compared. 27 fixed, 0 regressions, 0 unintended loosening.
        Every operation that worked against the baseline rules still works.
```

**v54.2 note on trusting that output.** In v54.1 this same command printed `0 regressions` with
exit code 0 when `targaryen` was not installed — it had compared **zero** cases. It now refuses to
reach a verdict without a minimum number of cases, checks the sub-process exit status, requires
both runs to cover the same case set, and prints the tally above the verdict so the number can
never be read without the count it rests on. All five failure modes were injected and measured:
`SECURITY-TEST-RESULTS.md` §1.

**Do this yourself before publishing.** That backup file is my copy of what v54 shipped, not an
export of your live project, and the independent review is right that you should compare against
the real thing. The tool takes paths:

```bash
# Firebase console > Realtime Database > ⋮ > Export JSON   (the RULES, not the data)
node test/security/compat-diff.js ./my-live-rules.json firebase-rules.json
```

* **0 regressions** — nothing that works today stops working.
* **0 unintended loosening** — nothing that is refused today becomes allowed, except the four
  cases that belong to the new `avatars/` node, which is new ground rather than a relaxation.
* **203 cases identical.** Of the 27 differences: every one is either an attack that is now
  refused or a feature that was broken before this work and functions now. None is an operation
  that used to work and has stopped.

This is the document to re-run if you ever doubt the claim. It takes about a second and it needs
no network, no emulator, and no credentials.

### `test/security/attack-suite.js` — the 78 legitimate-operation half

The suite is deliberately half defence and half proof-of-life. The 90 `allow()` cases are
real operations lifted from your own client code, replayed through
[targaryen](https://www.npmjs.com/package/targaryen) — a real implementation of the Realtime
Database rules language, not a mock:

| Area | What is proved to still work |
|---|---|
| Sign-up | both atomic writes `_finishProfile()` makes: the id claim (`counters/userId` + `idToUid` + `uidToId`) and the profile+username+login-lookup write |
| Sign-in | session token write, presence write, `usernameLogin` lookup while unauthenticated (which sign-in *requires*) |
| Profile | display name, bio, pronouns, avatar, banner, theme, status, custom status |
| Private settings | own read and own write |
| Chat | sending with the atomic rate token, editing own message, deleting own message, loading paginated history, reactions, poll votes, typing indicators, pins |
| DMs | opening a conversation, sending, reading one you are in |
| Servers | creating one, joining, reading channels and the member list, nickname, leaving |
| Roles | server owner creating a role, assigning it, a member with `manageRoles` assigning it |
| Moderation | site mod deleting a message, timing a user out with a preset duration, owner using any duration, server staff with `manageMsg` deleting a member's message, kick, ban, unban |
| Voice | joining and leaving a voice channel |
| v54 features | activity, notes, achievements, saved messages, notification prefs, audit entries, server emoji, events, member screening |
| Store items | owner granting VIP (permanent and 24-hour) and MVP |

A refusal in any of these counts as **BROKEN** and fails the run. The current run is
`passed: 221, HOLES: 0, BROKEN: 0, ACCEPTED: 9`.

### What verification does *not* cover

Being straight about the edges, because "verified" should mean something:

* **targaryen is an implementation of the rules language, not Google's.** It is the same engine
  the Firebase community has used for this for years and it caught real bugs here, but it is not
  the production evaluator. If you want the production evaluator, the Local Emulator Suite is the
  way — see §5.
* **The fixture is a faithful miniature, not your database.** Seven accounts, two servers, the
  real node shapes. It cannot catch a problem that only exists in a record shaped in a way I have
  never seen. If any of your 3,100 accounts has, say, a profile field written by a version of ICH
  older than the current `users/$id/style` whitelist, this suite would not know.
* **Rules only govern access.** They cannot prove the client code renders correctly. That is what
  the 12 browser suites are for, and they are all green (`node test/run-v54.js` and friends).

---

## 2b. v54.1 specifically: the privacy split, and sign-in

This is the change that could have broken sign-in for 3,100 people, so it gets its own section.

### Sign-in

Nothing about Firebase Authentication changed. No account was created, deleted, reset or
re-registered; no UID and no ICH id moved; no password was touched. What changed is only how a
**username** is turned into the email Firebase knows the account by, and the client handles all
three possible record shapes:

| `usernameLogin/<name>` holds | Who has this | What the client does |
|---|---|---|
| `{email:"bob@itsuki.local"}` | every account, before the migration | signs in with it, exactly as before |
| `{email:"real@gmail.com"}` | real-email accounts, before the migration | signs in with it, exactly as before |
| `{alias:"bob"}` | alias accounts, after the migration | builds `bob@itsuki.local` |
| `{server:true}` | real-email accounts, after the migration | asks `/api/login`; or the person types their email |

So username sign-in works before the migration, during it, and after it. Tested — `run-privacy.js`
checks all four shapes, and the attack suite proves the unauthenticated lookup still reads.

**The one behaviour change, stated plainly:** after `--clear-source`, an account whose Firebase
Auth email is a real address can only sign in by username if `/api/login` is deployed. Without it
they sign in with their email address, which the sign-in box has always accepted, and the error
message says so. `migrate_privacy.js --dry-run` tells you exactly how many accounts that is and
names them, **before** you change anything. If the answer is zero, this paragraph does not apply
to you.

### Renaming

Renaming an account never changed its Firebase Auth email, and still doesn't. The alias stays
pinned to the username the account signed up under, so a person who signed up as `bob` and is now
`rob` still signs in as `bob@itsuki.local`. Deriving the alias from the current name would have
locked every renamed account out — which is why the local part is stored, and why there is a test
called "a renamed account keeps its ORIGINAL local part".

### Settings

Settings move to `userPrivate/$id/settings`. The client reads the new place and **falls back to
the old one**, so an un-migrated account keeps its preferences. `users/$id/settings` is left
writable in the rules on purpose, so a browser still running an old cached build does not start
failing mid-session.

### Profiles, member lists, mentions

These used to be served from a single download of the whole `users` branch. That download is
gone, and four features depended on it: @mention autocomplete, friend search by name, the shop's
username lookup, and the member count. All four are now built from the username directory
(`usernames`, name → id, a few tens of KB), with full records fetched per account as they appear
on screen — and those fetches are **live listeners**, so a profile edited elsewhere still updates
without a reload. 32 browser checks cover this; `SECURITY_TEST_RESULTS.md` §2 lists them.

### The Daily Spin

`spinClaims/$id` is new and server-written. `lastSpin` and `spinWin` are still written by the
client exactly as before, so nothing about the existing UI changes — they are a display mirror
now rather than the authority.

### NSFW scanning

Off until `/api/nsfw` is deployed, because the browser no longer has a credential. That is the
same behaviour the filter has always had when it could not reach the service: images go through.
Nothing errors and nobody is blocked.

---

## 2c. v54.2 specifically — the full section-7 checklist

Baseline: v54.1. Every item you listed, and how it was verified.

| Area | Verified by | Result |
|---|---|---|
| Existing login | `compat-diff` + `attack-suite`: session write, presence write, the pre-auth username lookup in all four record shapes | unchanged |
| Existing account sessions | nothing touches `sessions/`; no token is invalidated | unchanged |
| Username lookup | all four shapes (`{email}` legacy, `{email}` alias, `{alias}`, `{server}`) | unchanged |
| Registration | both atomic writes of `_finishProfile()` | unchanged |
| Profile loading | read by id, read the username directory, `getUser()` live listener | unchanged |
| Profile editing | display name, bio, pronouns, avatar, banner, theme, status, custom status | unchanged |
| Friends | request, accept, list | unchanged |
| DMs | open, send, read one you are in | unchanged |
| Server creation | create, with the owner's membership row | unchanged |
| Server joining | join, read channels, read the member list, nickname, leave | unchanged |
| Server ownership | owner-only operations on their own server | unchanged |
| Roles and permissions | role create, assign by owner, assign with `manageRoles`, the full moderation ladder | unchanged |
| Messaging | the real atomic send including the rate token, paginated history, reactions, pins, typing | unchanged |
| Message deletion | own message, site mod, server staff with `manageMsg`, and who may act on whom | unchanged |
| Settings | own read, own write — now at `userPrivate/$id`, with a read fallback to the legacy copy | **changed location, same behaviour** |
| Purchases | `/api/totaward` owners-only and recomputes placings; `customroles` unwritable | unchanged |
| Coin systems | `tot/p/$id` self-write unchanged (see `REMAINING-RISKS.md` V4) | unchanged |
| Streaks | `lastSpin` / `spinWin` still client-written and client-read | unchanged (now a display mirror) |
| Daily Spin | 80 state-machine checks + 39 concurrency checks; the v54.1 record shape is still honoured | **changed internals, same UI** |
| VIP / MVP | badges, perks, the owner-only grant path, permanent VIP never downgraded | unchanged |
| Presence | scoped to the open room, re-armed on a 30s heal, torn down on sign-out | unchanged |
| Notifications | `notifPrefs`, mention extraction, the DND window | unchanged |
| Existing user data | messages, friends, roles, membership, profiles: no rule touching them changed | unchanged |

### Every intentional behaviour change in v54.2

Four, and none of them can lock anybody out of an account.

1. **The spin endpoint's responses gained states.** `/api/spin` can now answer `202
   {state:'processing'}` (the previous attempt is still in flight — wait and retry with the same
   nonce) and `503 {state:'refunded'}` (the payout failed and the spin was given back). The client
   handles both; the wheel and the prizes look identical. With `CFG.SPIN_API` empty — the default —
   none of this is reachable and the browser behaves exactly as in v54.
2. **`spinClaims` and the new `spinPayouts` are server-written only.** `lastSpin` and `spinWin` are
   still written by the client exactly as before, so the existing UI is unaffected — they are a
   display mirror now rather than the authority. Forging one changes what your own button looks
   like and grants no spin.
3. **The server-permission cache rejects unknown keys.** A member with `manageRoles` could
   previously write `serverMembers/$sid/$id/p/anything`. Nothing read those keys, so nothing
   behaved differently; it was unvalidated storage. No legitimate operation wrote one — verified by
   `compat-diff` showing 0 regressions across all 230 cases.
4. **`scripts/migrate_privacy.js` is superseded**, and its `--rollback` should not be used. The
   file is kept (the test suites import its pure functions and reproduce its rollback to
   demonstrate the bug) with a header saying so. Use `migration-backup.js` → `migration.js` →
   `rollback.js`.

Nothing was silently removed. The v54.1 changes — the privacy split, the credential move, NSFW
scanning needing an endpoint — are unchanged from v54.1 and documented in §2b.

---

## 3. The one change that touches existing data — and why it is safe

The free-plan problem in `FREE-PLAN-COMPATIBILITY.md` is that every sign-in downloads the whole `users`
branch, and 87% of those bytes are inline avatars: **~18 MB per page load, ~567 page loads a
month** before the 10 GB allowance is gone. Fixing it means moving avatars out of `users`.

That is a data migration, so it is built to your rules, not mine:

* **Additive.** `scripts/migrate_avatars.js` copies `users/$id/style/{avatar,banner}` to
  `avatars/$id/{a,b}`. It writes nothing inside `users`. Both copies are valid at once.
* **Reversible.** Until you pass `--clear-source`, the original data is untouched — deleting the
  `avatars` node puts you back exactly where you were. `--clear-source` *refuses to run* unless
  the copy is already complete for every record.
* **Dry-run first.** `--dry-run` reads and reports and writes nothing. That is the way in.
* **Re-runnable.** A record already copied identically is skipped, so an interrupted run resumes.
* **Backed up first.** Step 2 of the plan in `FREE-PLAN-COMPATIBILITY.md` is a full JSON export, and it
  is not optional — it is your way back after `--clear-source`.
* **You run it.** It needs a service account from your own machine. Nothing here can reach your
  database.
* **The rules for the new node were added and tested** (`scripts/add_rules_avatars.py`, already
  applied to `firebase-rules.json`). Ten test cases cover it: cross-user write refused, 5 MB
  string refused, `javascript:` URI refused, animated banner without MVP refused, unknown field
  refused, unauthenticated read refused, and the four legitimate owner operations allowed. The
  caps and the MVP gate are lifted verbatim from `users/$id/style`, so the new path is neither
  stricter nor looser than the field it replaces.
* **The client keeps a fallback.** Reads prefer `avatars/$id` and fall back to
  `users/$id/style/avatar`, so an account that has not been copied yet still shows its picture.

If you never run it, nothing breaks. You stay on 567 page loads a month.

---

## 4. Password changing — what is real and what I refused to fake

Your auth **is** Firebase Authentication email/password, with `username@itsuki.local` as the
internal alias. So the supported operations are genuinely available, and
`DB.changePassword(current, next)` now does it properly:

1. `reauthenticateWithCredential()` with the current password — the recent-login verification
   Firebase requires, and the thing that stops a hijacked tab from changing a password.
2. `updatePassword()` on success.
3. Mapped error codes (`wrong-password`, `weak-password`, `requires-recent-login`, `too-many-requests`).
4. A provider check first, so an account without a password provider is told so rather than shown
   a form that cannot work.

**No password is read, stored, or written to the Realtime Database at any point** — not hashed,
not plaintext. Firebase Auth holds them; ICH never sees them.

**Password *reset* is left off, deliberately.** It cannot work for your accounts, and I would
rather say that than ship a button that lies. Reset works by emailing a link, and
`username@itsuki.local` is not a deliverable address — there is no inbox. For the minority of
accounts registered with a real email, `sendPasswordResetEmail()` would work, but a reset flow
that silently works for some accounts and silently fails for most is worse than none. See
`SECURITY_AUDIT.md` A7 for the options if you want it later.

---

## 5. Before you publish the rules — the 20 minutes I would spend

The comparison above is strong evidence, and it is not the production evaluator. If you want
certainty against Google's own implementation, this is the cheapest path and it costs nothing:

```bash
# 1. Export your live data (also your migration backup)
#    Firebase console > Realtime Database > ⋮ > Export JSON

# 2. Point the emulator at the new rules and the real data
npm i -g firebase-tools
firebase emulators:start --only database --import ./ich-export.json
#    firebase.json: { "database": { "rules": "firebase-rules.json" } }

# 3. Open your ICH build against the emulator and sign in as a real account,
#    then: load the chat, send a message, open your profile, open a server.
```

If a real record of yours has a shape my fixture does not, that is where it surfaces — with your
live data and Google's evaluator, and with zero risk, because the emulator is a local copy.

I did not run this for you because it needs your data export, and your instruction was not to
touch production. The rules-unit-testing harness you mentioned is the same story: it needs the
emulator running, and `test/security/` does the equivalent work without it.

---

## 6. If something does go wrong after publishing

The rollback is one paste and it is instant, which is the main reason this is low-risk:

1. Open Firebase console → Realtime Database → **Rules**.
2. Paste the entire contents of **`firebase-rules.v54-original.json`**.
3. Publish.

You are back to today's behaviour, including today's privilege escalation. Keep that file.

Rules changes are not destructive and they are not migrations — they govern access and nothing
else. Publishing them cannot alter, move, or delete a single record. The worst case is that some
operation is refused, you roll back, and you tell me which one.

---

## 7. Checklist

Your "ABSOLUTELY DO NOT" list, item by item.

| You said do not | Status |
|---|---|
| Delete accounts | ✅ nothing in this work deletes a Firebase Auth account |
| Reset passwords | ✅ no reset is implemented, deliberately (§4) |
| Recreate accounts | ✅ the sign-up path is unchanged; both its writes are tested |
| Change UIDs | ✅ `uidToId`/`idToUid` are write-once and untouched |
| Change ICH user IDs | ✅ `counters/userId` untouched |
| Delete usernameLogin records | ✅ the migration **rewrites the value in place**; the name stays claimed by the same account |
| Wipe messages | ✅ not touched |
| Reset profiles | ✅ public profile fields untouched; only `email` and `settings` move, and only after being verified |
| Reset friends | ✅ not touched |
| Reset roles | ✅ not touched |
| Reset server membership | ✅ not touched |
| Replace production data with test data | ✅ no fixture, seed or test value is written anywhere near production |
| Automatically deploy Firebase rules | ✅ nothing was published; the rules are a file in this ZIP |

And the verification claims:

| Requirement | Status |
|---|---|
| Every existing operation compared against the new rules | ✅ `compat-diff.js`, 230 cases, **0 regressions** |
| Can all accounts still sign in? | ✅ verified — session write, presence write, and the pre-auth username lookup in all four record shapes |
| Access their profiles? | ✅ verified — own read, own write, cross-user read by id |
| Send messages? | ✅ verified — the real atomic send, including the rate token |
| Access servers? | ✅ verified — channels, member list, nickname, join, leave |
| Existing friends intact? | ✅ verified — request, accept, list |
| Existing permissions intact? | ✅ verified — role create/assign, the moderation ladder |
| Use existing features? | ✅ verified — the 90 legitimate-operation cases, plus 32 browser checks and 600+ in the existing suites |
| Every migration additive, reversible, documented | ✅ `PRIVACY_MIGRATION.md`; `--dry-run`, `--verify`, `--rollback`, and `--clear-source` refuses unless verification passes |
| Nothing deployed | ✅ no rules published, no credential rotated, no production data read or written |

---

## 8. The two things that are genuinely different afterwards

Everything above says "unchanged". These two are not, and burying them would make the rest of this
document worth less.

1. **After `--clear-source`, real-email accounts need `/api/login` for username sign-in.** Without
   it they sign in with their email address, which has always worked. `--dry-run` tells you how
   many accounts and names them before you commit to anything. Often this number is zero.

2. **NSFW scanning is off until `/api/nsfw` is deployed.** The browser has no credential now, by
   design. This is the same fail-open behaviour the filter has always had when the service was
   unreachable — images go through, nothing errors.

Neither can lock anybody out of their account, and both are reversible by deploying a function
you already have the infrastructure for.
