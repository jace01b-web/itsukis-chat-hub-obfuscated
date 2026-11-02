# One database-rules change (Firebase console > Realtime Database > Rules)

Replace ONLY the `"ipBans"` block with this. It lets staff write an IP ban from the site, and lets any signed-in
browser look up its OWN network's ban (it can only read a key it already knows). The full list stays staff-only.

```json
  "ipBans": {
   ".read": "auth != null && (root.child('owners').child(root.child('uidToId').child(auth.uid).val() + '').val() === 1 || root.child('secretowner').child(root.child('uidToId').child(auth.uid).val() + '').val() === 1 || root.child('admin').child(root.child('uidToId').child(auth.uid).val() + '').val() === 1)",
   "$h": {
    ".read": "auth != null",
    ".write": "auth != null && (root.child('owners').child(root.child('uidToId').child(auth.uid).val() + '').val() === 1 || root.child('secretowner').child(root.child('uidToId').child(auth.uid).val() + '').val() === 1 || root.child('admin').child(root.child('uidToId').child(auth.uid).val() + '').val() === 1)",
    ".validate": "newData.hasChildren(['at','by']) && newData.child('at').isNumber() && newData.child('by').isNumber()"
   }
  },
```
Nothing else changes (`tosAccepted` already accepts an `ip` field). Do NOT set `security/enforce` to true until /api is deployed.
