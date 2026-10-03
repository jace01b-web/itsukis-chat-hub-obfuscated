# Itsukis Chat Hub - split project

The old single `index.html` (10,000+ lines) is now a normal folder. The code itself is unchanged;
it was only cut into files and given a loader.

```
index.html              page markup + <link>/<script> wiring only
build-single.js         optional: merges everything back into one file (see below)
css/                    18 stylesheets, numbered in the order they apply
js/
  manifest.js           THE list of css/js files and their load order  <- edit this to add files
  loader.js             imports Firebase once, then loads the files in manifest order
  early/                runs in <head> before first paint (anti-lag flag, stylesheet links)
  core/                 firebase-imports, config, helpers, firebase-init, database (DB layer),
                        state, auto-update, sound, boot, crash-catcher
  moderation/           content-filter, roles, nsfw-filter, bans
  auth/                 sign in / sign up
  chat/                 chat-view (sidebar, rooms & DM list), chat-header, messages, composer,
                        attachments, emoji-data, emoji-picker, text-and-media, pings,
                        typing-indicator, live-sync
  social/               friends, rooms, user-profile
  games/                game-hubs (proxy browser + iframe viewer), hub-info, auth-hubs-preview
  tools/                music-player, now-playing
  settings/             settings-page, account, appearance, rules, rules-check, anti-lag
  features/             halloween (delete the file + css/17-halloween.css to remove the event),
                        vip-and-spin, gift-promo
  ui/                   controls, navigation, modals, home, extras-menu, liquid-glass,
                        context-menu, sidebar-toggle, auth-card-motion, ad-copy
```

## Rules for the js files
* All js files share ONE global scope (like one big file). A file may only *use* something at load
  time if an earlier file in `manifest.js` already defined it. Functions that are only called later
  (clicks, timers, callbacks) can live in any file.
* Every file starts with `'use strict'`, same as the old `<script type="module">`.
* Add a feature: create `js/<folder>/thing.js`, then add `"<folder>/thing.js"` to `manifest.js`.
* `settings/settings-page.js` and `settings/account.js` load *before* `features/halloween.js` on
  purpose - Halloween wraps those two functions when it loads.

## Hosting
Upload the whole folder to any static host (GitHub Pages, Netlify, ...). It must be served over
http(s); opening index.html by double-click will not work (browsers block module imports from
file://). To test locally: `python3 -m http.server` in this folder, then open http://localhost:8000.

## build-version (important)
`<meta name="build-version">` in index.html is untouched and still drives the auto-update and the
owner "Version control" lock. It is also added as `?v=...` to every css/js request, so **when you
change any file, bump it** (and re-pin it in Moderation > Version control if you use the pin),
otherwise browsers can keep serving cached copies of the old files.

## One-file build
`node build-single.js` writes `dist/index.single.html` (everything inlined, relative paths gone).
Use it for launcher / about:blank / blob windows, where `js/...` paths can't resolve.
A pre-built copy of the current version is already in `dist/`. Re-run after every change.

## Not split (on purpose)
* `js/core/database.js` (~1,580 lines) is one closure holding all the live data caches; the
  users / rooms / DM / friends / message functions share its private variables.
* `openSettings()` (~840 lines) is one function whose tabs share local variables.
* DMs have no separate code path: a DM is a room whose key starts with `dm_`, so DM behaviour
  lives in chat-view / chat-header / messages / composer.
Splitting those further means rewriting them, not just moving code - best done with a test login.
