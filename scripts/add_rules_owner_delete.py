#!/usr/bin/env python3
"""
scripts/add_rules_owner_delete.py - v54.6: the site owner can delete any custom server again.

    python3 scripts/add_rules_owner_delete.py firebase-rules.json firebase-rules.json

WHY
  v54.4 gave site owners this power. v54.5 took it back
  (scripts/remove_rules_owner_delete.py) on the grounds that destroying somebody's server is
  irreversible in a way no other staff power is. That is true, and it is why the client's
  confirmation now names the server and its member count out loud - but it left the person who
  runs the site unable to take down a server that has to go, which is not a tenable place to
  be. v54.6 restores the grant and keeps the loud confirmation.

WHAT THIS CHANGES
  Exactly the two edits remove_rules_owner_delete.py made, reversed, plus one node it never
  covered:

  1. The nine branch-level DELETE grants read

         auth != null && !newData.exists() && (SRV_OWNER)

     and become

         auth != null && !newData.exists() && (SRV_OWNER || SITE_OWNER)

     Note what is NOT widened: `!newData.exists()` stays, so this is a grant to REMOVE the
     branch and nothing else. A site owner still cannot write a whole new serverMembers/$sid or
     roomMembers/$room map in one go, which is what would let one be rewritten wholesale.

  2. servers/$sid, serverChannels/$sid and serverRoles/$sid had their site-owner branch wrapped
     in "newData.exists() && (...)", which is false exactly while the branch is being deleted.
     The wrapper is removed, so the branch covers the delete again.

  3. NEW in v54.6 - auditLog/$sid gains a branch-level delete grant of the same shape. It never
     had one, so a deleted server's audit log was unreachable afterwards: keyed by an id that
     resolves to nothing, readable by nobody (its .read asks the server that no longer exists
     who its owner is), and impossible to remove. deleteServer() clears it now, and this is the
     rule that lets it.

WHAT IS DELIBERATELY NOT GRANTED
  serverBoosts/$sid/$uid stays writable only by $uid. A site owner deleting a server they do
  not boost still cannot clear other people's boost records, and deleteServer() does not try -
  the whole multi-path write would be refused and take the delete down with it. Each booster's
  own client drops the dangling slot through DBoost.prune() on sign-in.
  serverOrder/$uid/$sid likewise stays the member's own to write.

RUN THE SUITES AFTERWARDS
  The attack suite carries cases asserting the v54.5 behaviour; they are updated in the same
  change to assert this one. compat-diff reports these as differences against the v54 baseline,
  which is correct and intended.

      npm test
"""
import json, sys, collections

if len(sys.argv) != 3:
    sys.exit("usage: add_rules_owner_delete.py <in.json> <out.json>")

SRC, OUT = sys.argv[1], sys.argv[2]
D = collections.OrderedDict

with open(SRC, encoding='utf-8') as f:
    doc = json.load(f, object_pairs_hook=D)
rules = doc["rules"]

MY = "root.child('uidToId').child(auth.uid).val() + ''"
SITE_OWNER = ("(root.child('owners').child(%s).val() === 1 || "
              "root.child('secretowner').child(%s).val() === 1)" % (MY, MY))
SRV_OWNER_TMPL = ("root.child('idToUid').child(root.child('servers').child(%s)"
                  ".child('ownerId').val() + '').val() === auth.uid")

report, skipped = [], []

# ------------------------------------------------- 1. the nine branch-level wipe grants
NINE = [("serverBans", "$sid"), ("serverMutes", "$sid"), ("serverIpBans", "$sid"),
        ("invites", "$sid"), ("serverMembers", "$sid"), ("serverEvents", "$sid"),
        ("serverEmoji", "$sid"), ("memberScreen", "$sid"), ("roomMembers", "$room")]

for node_name, wildcard in NINE:
    node = rules.get(node_name)
    if node is None or wildcard not in node:
        skipped.append("%s/%s (not in the rules)" % (node_name, wildcard))
        continue
    target = node[wildcard]
    cur = target.get(".write")
    if not isinstance(cur, str):
        skipped.append("%s/%s (no .write to widen)" % (node_name, wildcard))
        continue
    if SITE_OWNER in cur:
        report.append("%s/%s already grants the site owner - left alone" % (node_name, wildcard))
        continue
    if not cur.endswith(")"):
        skipped.append("%s/%s (.write not in the expected shape - LEFT ALONE)" % (node_name, wildcard))
        continue
    if "!newData.exists()" not in cur:
        # Refuse to touch anything that is not the delete-only grant this script is about.
        skipped.append("%s/%s (not a delete-only grant - LEFT ALONE)" % (node_name, wildcard))
        continue
    target[".write"] = cur[:-1] + " || " + SITE_OWNER + ")"
    report.append("%s/%s: the site owner may remove the branch again" % (node_name, wildcard))

# ---------------------------------- 2. servers / serverChannels / serverRoles: drop the wrapper
WRAPPED = "(newData.exists() && " + SITE_OWNER + ")"
for node_name, wildcard in [("servers", "$sid"), ("serverChannels", "$sid"), ("serverRoles", "$sid")]:
    node = rules.get(node_name, {}).get(wildcard)
    if node is None or not isinstance(node.get(".write"), str):
        skipped.append("%s/%s (no .write found)" % (node_name, wildcard))
        continue
    cur = node[".write"]
    if WRAPPED not in cur:
        if SITE_OWNER in cur:
            report.append("%s/%s site-owner branch already covers deletes - left alone"
                          % (node_name, wildcard))
        else:
            skipped.append("%s/%s (no wrapped site-owner branch found)" % (node_name, wildcard))
        continue
    node[".write"] = cur.replace(WRAPPED, SITE_OWNER)
    report.append("%s/%s: the site-owner branch covers deleting the branch again"
                  % (node_name, wildcard))

# ------------------------------------------------------------- 3. auditLog/$sid, new in v54.6
audit = rules.get("auditLog", {}).get("$sid")
if audit is None:
    skipped.append("auditLog/$sid (not in the rules)")
elif isinstance(audit.get(".write"), str):
    report.append("auditLog/$sid already has a branch-level write - left alone")
else:
    audit[".write"] = ("auth != null && !newData.exists() && (%s || %s)"
                       % (SRV_OWNER_TMPL % "$sid", SITE_OWNER))
    report.append("auditLog/$sid: the server owner and the site owner may remove the branch "
                  "(new - a deleted server's log could not be cleared before)")

with open(OUT, "w", encoding='utf-8') as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
    f.write("\n")

print("wrote %s" % OUT)
for line in report:
    print("  " + line)
for line in skipped:
    print("  SKIPPED " + line)
print("")
print("Run the suites next:")
print("  npm test")
