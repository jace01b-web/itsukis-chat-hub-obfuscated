# File uploads (GIF / video / audio / text files / other files) — setup

Code is done. Three things have to be switched on in Firebase (project **itsuki-chat**), otherwise uploads are refused.

## 1. Storage must exist
Firebase console → **Build → Storage → Get started**. The default bucket must be `itsuki-chat.firebasestorage.app`
(that is the name already in `js/core/firebase-init.js`). Note: Google now requires the **Blaze** (pay-as-you-go) plan
for new default buckets; the free allowance is still generous, and you can set a budget alert.

## 2. Publish the two rule files
* **Realtime Database → Rules**: paste `database.rules.json` (your old rules + a `files` field on messages; nothing else changed).
* **Storage → Rules**: paste `storage.rules`.
  Only signed-in users can upload into their own folder `chat/<uid>/`, with a type allow-list and a 50 MB cap
  (50 MB max for every file type). Edit the numbers in BOTH `storage.rules` and `FILES.LIMITS` in `js/chat/file-upload.js` if you want other caps.

## 3. (Optional but recommended)
* **"Show more" on text files** needs CORS on the bucket (without it, the snippet + Download still work):
  `gsutil cors set cors.json gs://itsuki-chat.firebasestorage.app`
* **Auto-clean old uploads** so Storage doesn't fill up. Messages are already pruned after `retentionDays` (7 by default); give files the same lifetime:
  save as `lifecycle.json` → `{"rule":[{"action":{"type":"Delete"},"condition":{"age":7}}]}` and run
  `gsutil lifecycle set lifecycle.json gs://itsuki-chat.firebasestorage.app`
  (Deleting a message yourself already deletes your own file; mods/owners can't delete other people's files from the client — the lifecycle rule covers those.)

## What users get
* **Paperclip / "+" → Upload a File**, **paste** (Ctrl+V) or **drag & drop** onto the chat.
* **GIFs** stay animated (the old image path turned everything into a still JPEG). Click to enlarge.
* **Videos** (mp4 / webm / mov) play inline; **audio** (mp3, wav, ogg, m4a, …) gets a player.
* **Text files** (.txt, .md, .log, .csv, .json and common code files) are sent as a real file card: name, size, a snippet, **Show more**, **Download**.
* **PDF, zip, Office docs, …** → file card with Download. Programs (.exe, .bat, .jar, …) are refused.
* Up to 5 files per message, with upload progress and a cancel (✕) button. Works in Global, DMs, rooms, VIP/MVP and the lockdown MVP lounge.
* Normal pictures still use the old compressed-in-the-database path, so they behave as before.

## Safety notes
* Text/code files are always stored as `text/plain` and served as downloads, so nothing uploaded can render as a web page.
* Only links to YOUR bucket are drawn, anything else in a message's `files` is ignored (client) and rejected (database rule).
* NSFW scanning: GIFs (first frame) and videos (3 frames) are scanned by the sender's client with the same Nyckel check as images. The owner/mod auto-sweep still only covers normal images — a modified client could skip the scan, so mods should still delete anything bad by hand.
* If Firebase Storage fails to load (blocked network), the site boots normally and only uploads are disabled.

## Deploying
Same as before: push the folder to the GitHub repo (the page loads js/css from it). `index.html`'s `build-version` was bumped to `2026-10-20.01`, so open tabs auto-refresh.
New files: `js/chat/file-upload.js`, `css/24-file-attachments.css`. Edited: manifest, loader, attachments, composer, messages, pings, database, lockdown, state, home, user-profile, chat-view, settings-page, index.html.
`build-single.js` was already out of sync with the raw-link `index.html` (it can't find the `<script src="js/manifest.js">` tag) so `dist/index.single.html` was not rebuilt and does not include file uploads.

---
# No Blaze plan? Use Cloudinary instead (free, no card) — GIFs, videos, audio, text & files

If Firebase won't let you upgrade, skip steps 1 and the Storage rules above. Files go to Cloudinary, and only the link is saved in your Firebase database like before.

1. Make a free account at cloudinary.com (no credit card). On the dashboard copy your **Cloud name**.
2. Settings (gear) → **Upload** → **Upload presets** → **Add upload preset**:
   * Signing mode: **Unsigned**
   * Folder: `ich-chat` (optional)
   * (If you see a "Return delete token" switch, turn it on — newer dashboards don't have it; that's fine, it only lets a cancelled upload be removed again.)
   * Save and copy the preset name.
3. Open `js/core/config.js` and fill in the two lines:
   `CLOUDINARY_CLOUD:'your-cloud-name',`
   `CLOUDINARY_PRESET:'your-preset-name',`
4. Paste the new `database.rules.json` into Realtime Database → Rules (it now accepts Firebase **or** Cloudinary links).
5. Push to GitHub.

Limits on Cloudinary's free plan: GIFs, text files and other files up to **10 MB**; videos and audio up to **50 MB** (the site enforces this). Free allowance is a shared ~25 GB/month of storage + bandwidth, so keep an eye on the dashboard.
Differences: uploaded files stay until you delete them in the Cloudinary Media Library (deleting a chat message doesn't remove the file); web-page files (.html) must be renamed to .txt.
Blocked school networks: some may block cloudinary.com — then uploads fail with a "network problem" message while the rest of the chat still works.
