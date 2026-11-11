#!/usr/bin/env python3
"""
scripts/add_rules_spinpayouts.py — v54.2 finding #4.

    python3 scripts/add_rules_spinpayouts.py firebase-rules.json firebase-rules.json

api/spin.js now records a payout marker:

    spinPayouts/$id/<txnId> = { at, prize }

written in the SAME atomic PATCH as the rewards themselves. That is what makes crash recovery
possible: if the function dies between reserving a spin and marking it complete, the next request
asks this node whether the payout actually landed, and resolves the transaction to `completed` or
`refunded` accordingly.

The whole design rests on that marker being truthful, so no browser may write it:

    .read   the account itself, and site owners  (so a client could show its own history)
    .write  FALSE, for everybody, always

Note what a forged marker would buy: it would make a stuck transaction resolve to `completed`
rather than `refunded`, which COSTS the forger a spin rather than granting one. The reason to
deny writes anyway is the opposite direction - deleting a marker would turn a paid spin into a
refunded one, granting a second spin for a prize already awarded. `.write: false` stops both.

Also tightens the v54.1 `spinClaims` node: it was added before the transaction states existed,
and this records in the rules file itself that the node is server-owned.
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

changed = []

if "spinPayouts" not in rules:
    rules["spinPayouts"] = D([
        ("$id", D([
            (".read",  "%s && (%s || %s)" % (AUTHED, IS_SELF, SITE_OWNER)),
            # Written ONLY by api/spin.js through the service account, which is not subject to
            # these rules. Every browser - the account's own and a site owner's - is refused.
            (".write", False),
        ])),
    ])
    changed.append("added spinPayouts/$id  (.read = self or site owner, .write = false for every browser)")
else:
    changed.append("spinPayouts was already present - left as it is")

# spinClaims must exist already (v54.1). Verify rather than assume.
sc = rules.get("spinClaims")
if not sc:
    raise SystemExit("spinClaims is missing - run scripts/add_rules_spinclaims.py first.")
if sc.get("$id", {}).get(".write") is not False:
    raise SystemExit("spinClaims/$id/.write is not false. Refusing to continue: the spin state "
                     "machine depends on no browser being able to write that node.")
changed.append("verified spinClaims/$id/.write is still false")

with open(OUT, "w", encoding='utf-8') as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
    f.write("\n")

print("wrote %s" % OUT)
for c in changed:
    print("  " + c)
print("")
print("Both nodes are server-owned. The transaction states in spinClaims and the payout markers")
print("in spinPayouts are the only record of what was paid, so a browser that could write either")
print("could grant itself a spin or a prize.")
