#!/usr/bin/env python3
"""
scripts/remove_rules_owner_delete.py — v54.5: a site owner can no longer delete a server.

    python3 scripts/remove_rules_owner_delete.py firebase-rules.json firebase-rules.json

WHY, when v54.4 deliberately added it
  v54.4 gave site owners the power to delete anybody's server, reasoning that they already
  outrank every server everywhere else. Outranking a server is not the same as owning it.
  Every other staff power is reversible - a ban is lifted, a role is handed back, a channel is
  remade - and this one is not: it destroys the server, its channels, its roles, its invites
  and its entire history for every member, with no undo and no copy kept anywhere.

  So deleting a server goes back to the person who created it. Site owners keep every other
  power over somebody else's server (moderating it, editing it, managing roles and members),
  and keep deleting servers they own themselves.

WHAT CHANGES
  This is a TIGHTENING, not a loosening: it takes a grant away and adds none. Two kinds:

  1. The nine branch-level delete grants v54.4 added (scripts/add_rules_server_delete.py) read

         auth != null && !newData.exists() && (SRV_OWNER || SITE_OWNER)

     and become

         auth != null && !newData.exists() && SRV_OWNER

     The server owner's half is untouched, so deleting your own server still works - which was
     the actual bug v54.4 set out to fix, and it stays fixed.

  2. servers/$sid/.write loses the SITE_OWNER branch for the DELETE case only. A site owner
     must still be able to EDIT somebody else's server (rename it, change its icon, moderate
     it), so the branch is narrowed rather than removed: it now excludes the case where the
     whole node is being removed.

RUN THE SUITES AFTERWARDS
  The attack suite carries cases that assert the v54.4 behaviour; they are updated in the same
  patch to assert this one instead. compat-diff reports these as changes against the baseline,
  which is correct and intended - see V54-5-CHANGES.md.
"""
import json, sys, collections, re

SRC, OUT = sys.argv[1], sys.argv[2]
D = collections.OrderedDict

with open(SRC, encoding='utf-8') as f:
    doc = json.load(f, object_pairs_hook=D)
rules = doc["rules"]

MY = "root.child('uidToId').child(auth.uid).val() + ''"
SITE_OWNER = ("(root.child('owners').child(%s).val() === 1 || "
              "root.child('secretowner').child(%s).val() === 1)" % (MY, MY))

report, skipped = [], []

# ---------------------------------------------------------------- 1. the nine wipe grants
# Each looks like "... && (<srv owner test> || <SITE_OWNER>)". Strip the SITE_OWNER disjunct
# and the parentheses that only existed to hold the two together.
def strip_site_owner(expr):
    # "(A || SITE_OWNER)" -> "A"   where SITE_OWNER is the exact string above
    needle = " || " + SITE_OWNER + ")"
    if needle not in expr:
        return None
    out = expr.replace(needle, ")")
    # The wrapper parens around the lone remaining test are now redundant but harmless; keep
    # them so the expression stays obviously grouped.
    return out

for node_name, wildcard in [("serverBans", "$sid"), ("serverMutes", "$sid"),
                            ("serverIpBans", "$sid"), ("invites", "$sid"),
                            ("serverMembers", "$sid"), ("serverEvents", "$sid"),
                            ("serverEmoji", "$sid"), ("memberScreen", "$sid"),
                            ("roomMembers", "$room")]:
    node = rules.get(node_name)
    if node is None or wildcard not in node:
        skipped.append("%s/%s (not in the rules)" % (node_name, wildcard))
        continue
    target = node[wildcard]
    cur = target.get(".write")
    if not isinstance(cur, str):
        skipped.append("%s/%s (no .write to narrow)" % (node_name, wildcard))
        continue
    if SITE_OWNER not in cur:
        report.append("%s/%s already has no site-owner branch - left alone" % (node_name, wildcard))
        continue
    new = strip_site_owner(cur)
    if new is None:
        skipped.append("%s/%s (.write not in the expected shape - LEFT ALONE)" % (node_name, wildcard))
        continue
    target[".write"] = new
    report.append("%s/%s: delete-only write is now the server owner alone" % (node_name, wildcard))

# ------------------------------------------- 2. servers/$sid, serverChannels, serverRoles
# Narrow, do not remove: a site owner still EDITS somebody else's server - renaming it,
# moderating it, fixing a channel or a role - and only loses the ability to remove the whole
# thing. Wrapping the existing site-owner branch in "newData.exists() && (...)" is the
# smallest change that says exactly that: it is false only while the node is being deleted.
#
# serverChannels and serverRoles are included because a branch-level write grant covers
# writing null to the branch, which is how deleteServer() removes them. Their OTHER branches
# (the server owner, and a member holding manageCh / manageRoles) are untouched, so the server
# owner's own delete keeps working.
for node_name, wildcard in [("servers", "$sid"), ("serverChannels", "$sid"), ("serverRoles", "$sid")]:
    node = rules.get(node_name, {}).get(wildcard)
    if node is None or not isinstance(node.get(".write"), str):
        skipped.append("%s/%s (no .write found)" % (node_name, wildcard))
        continue
    cur = node[".write"]
    if SITE_OWNER not in cur:
        report.append("%s/%s has no site-owner branch - left alone" % (node_name, wildcard))
        continue
    if "newData.exists() && " + SITE_OWNER in cur:
        report.append("%s/%s site-owner branch is already delete-safe - left alone" % (node_name, wildcard))
        continue
    # Guard every occurrence of the bare site-owner test with "the node is not being removed".
    node[".write"] = cur.replace(SITE_OWNER, "(newData.exists() && " + SITE_OWNER + ")")
    report.append("%s/%s: the site-owner branch no longer covers deleting the branch"
                  % (node_name, wildcard))

with open(OUT, "w", encoding='utf-8') as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
    f.write("\n")

print("wrote %s" % OUT)
for line in report:
    print("  " + line)
for line in skipped:
    print("  SKIPPED " + line)
print("")
print("This script only ever removes a grant. Run the attack suite and compat-diff next:")
print("  npm test")
