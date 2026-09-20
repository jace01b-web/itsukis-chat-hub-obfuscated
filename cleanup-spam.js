// Dry run:  node cleanup-spam.js 2026-09-19T00:00:00Z
// Delete:   node cleanup-spam.js 2026-09-19T00:00:00Z --delete
// Removes every account created at/after the given time (Auth login + all database records) and
// their messages in the global chat. CHECK THE DRY-RUN LIST FIRST so you don't delete real users.
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(require('./serviceAccount.json')),
  databaseURL: 'https://itsuki-chat-default-rtdb.firebaseio.com'
});
const since = Date.parse(process.argv[2]);
const doIt = process.argv.includes('--delete');
if (!since) { console.log('Give a start time, e.g. 2026-09-19T00:00:00Z'); process.exit(1); }
(async () => {
  const db = admin.database();
  const users = (await db.ref('users').get()).val() || {};
  const uidToId = (await db.ref('uidToId').get()).val() || {};
  const idToUid = {}; Object.entries(uidToId).forEach(([u, i]) => idToUid[i] = u);
  const victims = Object.entries(users).filter(([id, u]) => (u.createdAt || 0) >= since);
  console.log(victims.length + ' accounts created since ' + process.argv[2]);
  victims.forEach(([id, u]) => console.log('  #' + id + '  ' + u.username));
  if (!doIt) return process.exit(0);
  const ids = new Set(victims.map(([id]) => Number(id)));
  const upd = {};
  for (const [id, u] of victims) {
    const k = String(u.username || '').toLowerCase();
    Object.assign(upd, {
      ['users/' + id]: null, ['usernames/' + k]: null, ['usernameLogin/' + k]: null,
      ['onlineUsers/' + id]: null, ['userRooms/' + id]: null, ['lastRead/' + id]: null,
      ['friends/' + id]: null, ['friendRequests/' + id]: null, ['sentRequests/' + id]: null,
      ['rate/' + id]: null
    });
    // keep uidToId / idToUid so the numeric ID can never be reissued to someone else
  }
  const g = (await db.ref('messages/global').get()).val() || {};
  let m = 0;
  for (const [mid, msg] of Object.entries(g)) if (ids.has(Number(msg.senderId))) { upd['messages/global/' + mid] = null; m++; }
  await db.ref().update(upd);
  console.log('database cleaned; removed ' + m + ' global messages');
  for (const [id] of victims) { const uid = idToUid[id]; if (uid) await admin.auth().deleteUser(uid).catch(e => console.log('auth delete failed', uid, e.code)); }
  console.log('auth accounts deleted');
  process.exit(0);
})();
