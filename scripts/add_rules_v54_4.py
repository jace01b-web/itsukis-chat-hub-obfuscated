#!/usr/bin/env python3
"""
scripts/add_rules_v54_4.py — v54.4: public banner colour, and site-owner powers.

    python3 scripts/add_rules_v54_4.py firebase-rules.json firebase-rules.json

THREE CHANGES, all additive. Nothing existing is removed or made stricter, so every operation
that works today keeps working - verified by test/security/compat-diff.js.

1. users/$id/style/bnc  — the PUBLIC banner colour.

   The banner colour has always lived in `settings`, which is private: userView() only merges
   your own settings, so everybody else's banner fell back to their bubble colour. Nobody has
   ever seen anyone else's chosen banner. Mirroring it into the public `style` node is the same
   trick `bubble`, `text` and `avatar` already use.

   Named `bnc` rather than `banner` because `style/banner` is already the MVP banner IMAGE.

2. userBoosts / serverBoosts — site owners boost without MVP, and without the two-slot cap.

   Both nodes require `mvp/$myId` to exist before any write, and both cap the slot index at
   /^[01]$/. So a site owner who is not also MVP cannot boost at all, and nobody can hold more
   than two. Site owners now bypass the MVP requirement and may use slots 0-99.

   The cap stays at two for everybody else, enforced in the rule rather than only in the client:
   an MVP cannot hand themselves slot 7 by writing it directly. And 99 rather than unbounded
   because every slot is a key that costs storage on the free plan - 100 is past any real use.

3. Nothing is needed for "owners can delete any server" or "owners have every permission".
   Both are already allowed by the rules:
     * servers/$sid/.write already has an `|| SITE_OWNER` branch for an existing server
     * the permission cache and role nodes already gate on manager(), which includes SITE_OWNER
   What blocked them was a client-side check, fixed in js/discord/model.js. The attack suite
   covers both so it stays that way.
"""
import json, sys, collections

SRC, OUT = sys.argv[1], sys.argv[2]
D = collections.OrderedDict

with open(SRC, encoding='utf-8') as f:
    doc = json.load(f, object_pairs_hook=D)
rules = doc["rules"]

MY = "root.child('uidToId').child(auth.uid).val() + ''"
SITE_OWNER = ("(root.child('owners').child(%s).val() === 1 || "
              "root.child('secretowner').child(%s).val() === 1)" % (MY, MY))

report = []

# ------------------------------------------------------------------ 1. public banner colour
style = rules["users"]["$id"]["style"]
if "bnc" in style:
    report.append("users/$id/style/bnc was already present - left alone")
else:
    hexval = "newData.isString() && newData.val().matches(/^#[0-9a-fA-F]{3,8}$/)"
    # Insert next to the other public colours so the file reads in a sensible order.
    items = []
    for k, v in style.items():
        items.append((k, v))
        if k == "text":
            items.append(("bnc", D([(".validate", hexval)])))
    style_new = D(items)
    if "bnc" not in style_new:          # `text` missing for some reason: append before $other
        style_new = D([(k, v) for k, v in style.items() if k != "$other"]
                      + [("bnc", D([(".validate", hexval)]))]
                      + ([("$other", style["$other"])] if "$other" in style else []))
    rules["users"]["$id"]["style"] = style_new
    report.append("added users/$id/style/bnc (public banner colour, hex, same validate as bubble)")

# ------------------------------------------------------------------ 2. boosts for site owners
def open_boosts(node_name, path_to_uid):
    node = path_to_uid
    old_write = node.get(".write", "")
    if "owners" in old_write and "secretowner" in old_write:
        report.append(node_name + " already lets site owners write - left alone")
    else:
        # The MVP requirement becomes "MVP or site owner". Everything else is untouched, so a
        # member still may only write their OWN row.
        need_mvp = "root.child('mvp').child(%s).exists()" % MY
        if need_mvp not in old_write:
            raise SystemExit("unexpected %s/.write - refusing to guess:\n  %s" % (node_name, old_write))
        node[".write"] = old_write.replace(need_mvp, "(%s || %s)" % (need_mvp, SITE_OWNER))
        report.append(node_name + "/.write: MVP requirement is now 'MVP or site owner'")

    slot = node.get("$slot")
    if slot is None:
        raise SystemExit("no $slot under " + node_name)
    old_v = slot.get(".validate", "")
    if "[0-9]" in old_v:
        report.append(node_name + "/$slot already allows more than two slots - left alone")
        return
    if "$slot.matches(/^[01]$/)" not in old_v:
        raise SystemExit("unexpected %s/$slot validate - refusing to guess:\n  %s" % (node_name, old_v))
    slot[".validate"] = old_v.replace(
        "$slot.matches(/^[01]$/)",
        # 0-99 for a site owner, 0-1 for everybody else. The outer bound is there because every
        # slot is a stored key, and unbounded keys on the free plan are an unbounded bill.
        "$slot.matches(/^[0-9]{1,2}$/) && ($slot.matches(/^[01]$/) || %s)" % SITE_OWNER)
    report.append(node_name + "/$slot: site owners may use slots 0-99; everyone else stays at 0-1")

open_boosts("userBoosts/$uid", rules["userBoosts"]["$uid"])
open_boosts("serverBoosts/$sid/$uid", rules["serverBoosts"]["$sid"]["$uid"])

with open(OUT, "w", encoding='utf-8') as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
    f.write("\n")

print("wrote %s" % OUT)
for line in report:
    print("  " + line)
print("")
print("Additive only. Run test/security/compat-diff.js to confirm 0 regressions before")
print("publishing, and re-run it against an export of your LIVE rules as the baseline.")
