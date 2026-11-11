#!/usr/bin/env python3
"""
Adds the `avatars/$id` node to the rules. Step 1 of the avatar migration in FREE-PLAN-COMPATIBILITY.md.

    python3 scripts/add_rules_avatars.py firebase-rules.json firebase-rules.json

ALREADY APPLIED to the firebase-rules.json in this zip, so there is only one ruleset to publish.
It is completely inert until the client change in step 3 of that plan ships: nothing reads or
writes this node yet, so publishing it changes nothing about how the site behaves today.

WHY THE NODE EXISTS
  Avatars are stored inline in each user record (users/$id/style/avatar, capped at 400,000
  characters), and js/core/database.js subscribes to the WHOLE users node on every sign-in. So a
  page load downloads every account's avatar whether or not one of them is ever drawn - about
  18 MB at 3,100 accounts, which is roughly 567 page loads a month before the free plan's 10 GB
  download allowance is gone. Moving the bytes here lets `users` stay small enough to fetch one
  account at a time.

ACCESS IS DELIBERATELY IDENTICAL TO THE FIELD IT REPLACES
  users/$id/style/avatar is writable by that account and readable by any signed-in account. So is
  this. Nothing becomes more visible or less visible by moving - which is what makes the
  migration safe to do in stages with both places valid at once.

  The size caps are the same too (400,000 for an avatar, 150,000 for a banner), and the banner
  keeps its MVP/owner gate, so a non-MVP cannot acquire a banner by writing to the new path.
"""
import json, sys, collections

SRC = sys.argv[1] if len(sys.argv) > 1 else "firebase-rules.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else SRC

with open(SRC) as f:
    doc = json.load(f, object_pairs_hook=collections.OrderedDict)
rules = doc["rules"]
D = collections.OrderedDict

MY = "root.child('uidToId').child(auth.uid).val() + ''"
AUTHED = "auth != null && root.child('uidToId').child(auth.uid).exists()"
SITE_OWNER = ("(root.child('owners').child(%s).val() === 1 || "
              "root.child('secretowner').child(%s).val() === 1)" % (MY, MY))

# Lifted verbatim from users/$id/style so the two cannot drift: an avatar is a JPEG data URI
# under 400,000 chars, a banner is JPEG/PNG/WebP under 150,000 and needs MVP or owner.
AVATAR_OK = ("newData.isString() && (newData.val() === '' || "
             "(newData.val().matches(/^data:image\\/jpeg;base64,[A-Za-z0-9+\\/=]+$/) && "
             "newData.val().length < 400000))")
BANNER_OK = ("newData.isString() && (newData.val() === '' || "
             "(newData.val().length <= 150000 && "
             "newData.val().matches(/^data:image\\/(jpeg|png|webp);base64,[A-Za-z0-9+\\/=]+$/) && "
             "(root.child('mvp').child($id).exists() || %s)))"
             % ("(root.child('owners').child($id).val() === 1 || "
                "root.child('secretowner').child($id).val() === 1)"))

if "avatars" in rules:
    print("avatars node already present; nothing to do")
    sys.exit(0)

# Sanity: the fields this mirrors must still exist, or this is the wrong ruleset.
style = rules["users"]["$id"]["style"]
assert "avatar" in style and "banner" in style, "users/$id/style has no avatar/banner; aborting"

rules["avatars"] = D([
    (".read", AUTHED),
    ("$id", D([
        (".write", "%s && (root.child('idToUid').child($id).val() === auth.uid || %s)"
                   % (AUTHED, SITE_OWNER)),
        ("a", D([(".validate", AVATAR_OK)])),
        ("b", D([(".validate", BANNER_OK)])),
        ("$other", D([(".validate", False)])),
    ])),
])

if "avatars" not in rules:
    raise SystemExit("ABORT - the avatars node did not make it in")
for node in ("users", "messages", "serverMembers", "uidToId", "idToUid"):
    if node not in rules:
        raise SystemExit("ABORT - a node that was already there is missing: " + node)

with open(OUT, "w") as f:
    json.dump(doc, f, indent=1)
    f.write("\n")

print("wrote", OUT)
print("added avatars/$id/{a,b} - self-write, authed-read, same caps as users/$id/style")
print("inert until the client change in FREE-PLAN-COMPATIBILITY.md step 3 ships")
