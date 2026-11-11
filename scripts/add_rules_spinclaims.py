#!/usr/bin/env python3
"""
scripts/add_rules_spinclaims.py — v54.1 finding #3: Daily Spin concurrency.

    python3 scripts/add_rules_spinclaims.py firebase-rules.json firebase-rules.json

api/spin.js now claims a spin atomically before rolling, using one node as the single source
of truth:

    spinClaims/$id = { at, n, prize, nonce, last }

That only means anything if the browser cannot touch it. The service account bypasses the
rules, so the server keeps full access either way; this adds the node with:

    .read   the account itself, and site owners  (so the UI can show spins left honestly)
    .write  FALSE, for everybody, always

A false .write is not decoration. `lastSpin` and `spinWin` are still self-writable, because
the existing client has always written them and the UI reads them - but after this they are
only a display mirror. Rewriting your own lastSpin changes what your button looks like and
gets you nothing: the allowance is computed from spinClaims, which you cannot forge.
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

if "spinClaims" in rules:
    raise SystemExit("spinClaims is already in the rules - nothing to do.")

rules["spinClaims"] = D([
    ("$id", D([
        (".read",  "%s && (%s || %s)" % (AUTHED, IS_SELF, SITE_OWNER)),
        # Written ONLY by api/spin.js through the service account, which is not subject to
        # these rules. Every browser - including the account's own - is refused.
        (".write", False),
    ])),
])

with open(OUT, "w", encoding='utf-8') as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
    f.write("\n")

print("wrote %s" % OUT)
print("  added spinClaims/$id  (.read = self or site owner, .write = false for every browser)")
print("  lastSpin and spinWin stay self-writable on purpose: they are now a display mirror,")
print("  not the authority. The allowance comes from spinClaims.")
