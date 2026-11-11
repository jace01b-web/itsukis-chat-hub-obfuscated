#!/usr/bin/env python3
"""
scripts/add_rules_privacy.py — v54.1 finding #2: private user data exposure.

    python3 scripts/add_rules_privacy.py firebase-rules.json firebase-rules.json

WHAT IS WRONG TODAY

    "users": { ".read": "auth != null", "$id": { ... "email": ..., "settings": ... } }

  Read grants CASCADE and cannot be revoked at a deeper path. So that single line hands every
  signed-in account the whole table: everybody's real email address, everybody's private
  settings, and ~18 MB of inline avatars on every sign-in.

WHAT THIS DOES

  1. Removes `users/.read` and puts the read grant on `users/$id` instead.
     Nobody can download the branch any more - a read has to name one account.

  2. Creates `userPrivate/$id`, readable and writable by that account only (and the site
     owner, who can already do anything). `email` and `settings` live here from now on.

  3. Refuses NEW writes of `users/$id/email`. The field definition is removed, so the
     `$other` catch-all (`.validate: false`) rejects it. Existing values are untouched -
     rules never delete data; `scripts/migrate_privacy.js` moves them.

  4. Leaves `users/$id/settings` WRITABLE on purpose, so a browser still running the old
     cached build does not start failing mid-session. The new client writes to
     `userPrivate/$id/settings` and moves its own leftovers on sign-in, and the migration
     script sweeps the rest.

  5. Constrains `usernameLogin/$name` so the publicly readable login map can no longer
     carry a real address. Two new shapes replace it:

       {alias:"bob"}   this account signs in as bob@itsuki.local. The local part is stored
                       rather than derived from $name, because renaming an account does NOT
                       change its Firebase Auth email - the alias stays pinned to whatever
                       username it signed up under. A former public username is not a secret,
                       and this reveals exactly what `bob@itsuki.local` already did.
       {server:true}   this account's Auth email is a real address. The client never sees it;
                       it posts to /api/login, or the person signs in with their email as they
                       always could.

     `email` is still accepted, but only when it is the derivable alias for $name or the value
     already stored - so existing records keep working and no NEW real address can be published.

HONESTY NOTE, because this matters for the 3,100 accounts
  Step 1 alone does NOT fix the email exposure. ICH user ids are sequential (1, 2, 3 ...), so
  anyone signed in can still walk them one at a time. What actually removes the exposure is
  moving the data - the rules change only stops it being downloadable in one request. Run the
  migration. Until you do, treat every real email in `users/$id/email` as exposed.
"""
import json, sys, collections

SRC, OUT = sys.argv[1], sys.argv[2]
D = collections.OrderedDict

with open(SRC, encoding='utf-8') as f:
    doc = json.load(f, object_pairs_hook=D)
rules = doc["rules"]

AUTHED     = "auth != null && root.child('uidToId').child(auth.uid).exists()"
MY         = "root.child('uidToId').child(auth.uid).val() + ''"
SITE_OWNER = ("(root.child('owners').child(%s).val() === 1 || "
              "root.child('secretowner').child(%s).val() === 1)" % (MY, MY))
IS_SELF    = "root.child('idToUid').child($id).val() === auth.uid"

report = []

# ---------------------------------------------------------------- 1. the read grant
users = rules["users"]
if users.get(".read") is not None:
    report.append("removed users/.read  (was: %s)" % users[".read"])
    del users[".read"]
uid_rules = users["$id"]
if uid_rules.get(".read") is None:
    # Put it first so it reads like the rule it is.
    items = [(".read", AUTHED)] + [(k, v) for k, v in uid_rules.items()]
    users["$id"] = D(items)
    uid_rules = users["$id"]
    report.append("added users/$id/.read  (one account per read, no branch download)")

# ---------------------------------------------------------------- 2. email: no new writes
if "email" in uid_rules:
    email_rule = uid_rules.pop("email")
    report.append("removed the users/$id/email field definition - $other now refuses it "
                  "(was: %s)" % json.dumps(email_rule))

# ---------------------------------------------------------------- 3. userPrivate/$id
# The settings subtree is copied VERBATIM from users/$id/settings, so every cap and every
# validate that protects the public copy protects the private one identically.
settings_rule = json.loads(json.dumps(uid_rules["settings"]), object_pairs_hook=D)

rules["userPrivate"] = D([
    ("$id", D([
        (".read",  "%s && (%s || %s)" % (AUTHED, IS_SELF, SITE_OWNER)),
        (".write", "%s && (%s || %s)" % (AUTHED, IS_SELF, SITE_OWNER)),
        ("email", D([(".validate", "newData.isString() && newData.val().length <= 254")])),
        ("settings", settings_rule),
        ("$other", D([(".validate", False)])),
    ])),
])
report.append("added userPrivate/$id  (self + site owner only) with email and settings")

# ---------------------------------------------------------------- 4. usernameLogin
ul = rules["usernameLogin"]["$name"]
old_validate = ul[".validate"]
# Was: ... && newData.hasChild('email')
# Now: exactly one of the three shapes, and `email` may only be the derivable alias.
ul[".validate"] = (
    "$name.length >= 1 && $name.length <= 20 && "
    "$name.matches(/^[0-9a-z._-]+( [0-9a-z._-]+)*$/) && "
    "(newData.hasChild('email') || newData.hasChild('alias') "
    "|| newData.child('server').val() === true)"
)
ul["email"] = D([(".validate",
    "newData.isString() && newData.val().length <= 254 && "
    "(newData.val() === $name + '@itsuki.local' || "
    # An existing record keeps working: rewriting it to the value it already holds is allowed,
    # which is what a no-op profile save does. A DIFFERENT real address cannot be introduced.
    "newData.val() === data.val())")])
ul["alias"]  = D([(".validate",
    "newData.isString() && newData.val().length >= 1 && newData.val().length <= 20 && "
    "newData.val().matches(/^[0-9a-z._-]+$/)")])
ul["server"] = D([(".validate", "newData.val() === true")])
report.append("usernameLogin/$name: `email` may now only be the derivable @itsuki.local alias "
              "(or the value already stored); added the {alias:\"<localpart>\"} and "
              "{server:true} shapes, neither of which can name a real address")
report.append("  old .validate: %s" % old_validate)

with open(OUT, "w", encoding='utf-8') as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
    f.write("\n")

print("wrote %s" % OUT)
for line in report:
    print("  " + line)
print("\nREMINDER: the rules change stops the branch download. Moving the data is what removes")
print("the exposure - ICH ids are sequential, so a signed-in account can still walk them.")
print("Run scripts/migrate_privacy.js (dry-run first).")
