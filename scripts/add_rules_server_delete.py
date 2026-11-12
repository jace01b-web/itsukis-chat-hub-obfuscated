#!/usr/bin/env python3
"""
scripts/add_rules_server_delete.py — v54.4: make deleting a server actually work.

    python3 scripts/add_rules_server_delete.py firebase-rules.json firebase-rules.json

THE BUG, and it is not new
  DModel.deleteServer() builds ONE atomic multi-path update that removes the server and all
  fifteen of its side nodes. A multi-path update is all-or-nothing, so if a single path in it is
  refused, the whole delete fails.

  Nine of those paths were refused - for the SERVER OWNER as much as for a site owner:

      serverBans/$sid     serverMutes/$sid    serverIpBans/$sid
      invites/$sid        serverMembers/$sid  serverEvents/$sid
      serverEmoji/$sid    memberScreen/$sid   roomMembers/$channelKey

  Each of those nodes has a `.write` on its per-ENTRY child ($sid/$id, $sid/$code, ...) but none
  at the branch level, and you cannot write a path no rule grants. So deleting a server has
  never worked for anybody. It would have failed silently - the client awaits one update() and
  gets a permission error for the whole thing.

  Found by testing every path deleteServer() writes, rather than by reading the rules.

THE FIX
  A DELETE-ONLY `.write` at the branch level of each, for the server owner or a site owner:

      ".write": "auth != null && !newData.exists() && data.exists() && (srv_owner || SITE_OWNER)"

  `!newData.exists()` is what keeps this safe. A write grant on an ancestor cascades down, so a
  careless rule here would hand the server owner the right to overwrite every member's row. But
  this one can only ever be true when the ENTIRE branch is being removed - write anything to a
  child and `newData` at this level still exists, the rule is false, and the existing per-entry
  rules decide as they always did. Nothing is loosened; a delete becomes possible.

  roomMembers is keyed by CHANNEL, not by server (its wildcard is $room), so its rule resolves
  the owner through channelServer/$room -> servers/$sid/ownerId.
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
SRV_OWNER = ("root.child('idToUid').child(root.child('servers').child($sid).child('ownerId').val() + '').val() "
             "=== auth.uid")

# Deleting the whole branch, and nothing else.
# NOTE: deliberately NO `data.exists()`. deleteServer() writes every side node to null
# unconditionally, and most servers have no bans, no mutes and no invites - so those paths are
# deletes of nodes that are already absent. Requiring data.exists() refuses exactly those and
# fails the whole atomic update, which is the bug this script exists to fix. Deleting nothing
# is harmless.
WIPE = ("auth != null && !newData.exists() && (%s || %s)" % (SRV_OWNER, SITE_OWNER))

# roomMembers is keyed by channel: resolve the server through channelServer.
ROOM_SRV = ("root.child('idToUid').child(root.child('servers')"
            ".child(root.child('channelServer').child($room).val())"
            ".child('ownerId').val() + '').val() === auth.uid")
ROOM_WIPE = ("auth != null && !newData.exists() && "
             "root.child('channelServer').child($room).exists() && (%s || %s)" % (ROOM_SRV, SITE_OWNER))

report, skipped = [], []

def grant(node_name, wildcard, expr):
    parts = node_name.split('/')
    node = rules
    for p in parts:
        if p not in node:
            skipped.append(node_name + " (node not in the rules)")
            return
        node = node[p]
    if wildcard not in node:
        skipped.append(node_name + " (no %s child)" % wildcard)
        return
    target = node[wildcard]
    if target.get(".write") is not None:
        # Something already grants a write here. Do not stack another on top without looking.
        report.append("%s/%s already has a .write - LEFT ALONE: %s"
                      % (node_name, wildcard, str(target[".write"])[:60]))
        return
    # Put it first so it reads as the guard it is.
    rebuilt = D([(".write", expr)] + [(k, v) for k, v in target.items()])
    node[wildcard] = rebuilt
    report.append("%s/%s: delete-only .write for the server owner or a site owner" % (node_name, wildcard))

for n in ["serverBans", "serverMutes", "serverIpBans", "invites",
          "serverMembers", "serverEvents", "serverEmoji", "memberScreen"]:
    grant(n, "$sid", WIPE)

grant("roomMembers", "$room", ROOM_WIPE)

with open(OUT, "w", encoding='utf-8') as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
    f.write("\n")

print("wrote %s" % OUT)
for line in report:
    print("  " + line)
for line in skipped:
    print("  SKIPPED " + line)
print("")
print("Each grant is delete-only: it can never be true while any child still has a value, so")
print("no per-entry rule is weakened. Run the attack suite and compat-diff to confirm.")
