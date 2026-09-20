// Run ONCE before publishing the new rules.  npm i firebase-admin ; node backfill-idToUid.js
// Needs a service-account key (Firebase console > Project settings > Service accounts > Generate key).
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(require('./serviceAccount.json')),
  databaseURL: 'https://itsuki-chat-default-rtdb.firebaseio.com'
});
(async () => {
  const db = admin.database();
  const snap = await db.ref('uidToId').get();
  const upd = {};
  snap.forEach(c => { upd['idToUid/' + c.val()] = c.key; });   // reverse index: id -> auth uid
  await db.ref().update(upd);
  console.log(Object.keys(upd).length + ' ids backfilled');
  process.exit(0);
})();
