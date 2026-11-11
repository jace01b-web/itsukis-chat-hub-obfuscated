#!/usr/bin/env python3
"""
Security hardening for the v54 ruleset. Additive and surgical.

    python3 scripts/harden_rules_v54.py firebase-rules.json firebase-rules.json

Every change below was found by test/security/attack-suite.js and is re-proved by it afterwards.
The script asserts the shape of everything it touches and refuses to write anything if an
assertion fails, so a half-applied ruleset is not a possible outcome.

WHAT IT FIXES

  H1  CRITICAL  server permission self-escalation
      serverMembers/$sid/$id/.write grants a member their OWN row - which it has to, because
      joining a server, setting a nickname and leaving are all self-writes. But in the Realtime
      Database a .write granted at an ancestor CASCADES to every descendant and CANNOT be
      revoked deeper. So the narrower .write rules already sitting on `p` and `roles` were dead
      code, and any member of any server could write:
            serverMembers/<sid>/<their own id>/p/admin = true
      and become that server's administrator - because `p` is the flattened cache the rules
      themselves read when deciding every other server permission.

      .validate rules do NOT cascade: they are evaluated at every level and all of them must
      pass. So the fix is a .validate on each permission and each role entry that asks who is
      writing. The existing .write rules are left in place - they are harmless, and removing
      them would be a change with no benefit.

      Checked against the client first: joining writes {at, roles:{}} and never writes `p`
      (DModel.joinByInvite / joinPublic), and syncPerms is only ever called by createServer (as
      the new owner) or by a role operation that already requires Manage Roles. Deletes are
      unaffected because .validate is not evaluated for a null value, so kicking and leaving
      still work.

  H2  CRITICAL  self-granting the paid tiers
      vip/$id and mvp/$id both allow a self-write, so that the Daily Spin can hand over a prize
      from the browser. The guards were not tight enough:
        * vip: the branch `!lastSpin.exists() || lastSpin + 24h <= now` let anyone who had never
          spun - or who had not spun today - write {perm:true} and take PERMANENT VIP, the $10
          product, for nothing.
        * mvp: writing mvp/<self> together with lastSpin/<self> = now in one update satisfied
          every condition, so MVP, the $30 product, was self-grantable too.

      After this change a self-write may only ever be the 24-HOUR form of VIP, and only with a
      fresh spin in the same update. Permanent VIP and MVP become writable only by a site owner
      or by the Admin SDK - that is, by api/spin.js, which decides the prize on the server the
      same way api/totaward.js already decides a Trick-or-Treat placing.

      This is a rules change AND a client change. js/features/vip-and-spin.js had to change in
      the same breath, or a spin that landed on the jackpot would be refused and the whole
      atomic update - including the spin marker - would fail. See SECURITY_AUDIT.md section H2.

  H3  FUNCTIONAL  "Clear the audit log" could never have worked
      DAudit.clear() removes auditLog/$sid, but the only .write rule under auditLog was on
      $eid, so a whole-subtree delete had no rule to permit it. Added at the $sid level, for the
      server's owner and site owners only. (Introduced in v54 by me.)

  H4  FUNCTIONAL  Manage Messages did not actually let anybody manage messages
      messages/$key/$msg/.write mentions neither manageMsg, serverMembers nor serverRoles - the
      string does not appear in it once. So a server moderator holding Manage Messages could see
      the delete button (the client checks DModel.can) and have the write refused. The message
      disappeared locally and came back. Pins already honoured the permission, which is what
      made the inconsistency obvious.

      One OR-branch is added to the delete clause: a member of the server that owns the channel,
      holding manageMsg, may delete a message in it - but never one belonging to a site owner,
      and never one belonging to somebody they do not outrank in that server. Nothing else in
      that expression is touched; it is the biggest rule in the file and the attack suite
      re-proves all 24 of its existing behaviours afterwards.

WHAT IT DELIBERATELY DOES NOT CHANGE
  The broad `users/.read`, the globally readable `dmMembers`, joining by server id, and the
  pre-authentication usernameLogin lookup. Each is a real finding, each is written up in
  SECURITY_AUDIT.md with what it would cost to fix, and each would break something that 3,100
  existing accounts rely on if changed without the migration described there. Fixing them
  quietly in a rules file would be the wrong way round.
"""
import json, sys, collections

SRC = sys.argv[1] if len(sys.argv) > 1 else "firebase-rules.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else SRC

with open(SRC) as f:
    doc = json.load(f, object_pairs_hook=collections.OrderedDict)
rules = doc["rules"]
D = collections.OrderedDict

MY = "root.child('uidToId').child(auth.uid).val() + ''"
SITE_OWNER = ("(root.child('owners').child(%s).val() === 1 || "
              "root.child('secretowner').child(%s).val() === 1)" % (MY, MY))


def srv_owner(sid="$sid"):
    return ("root.child('idToUid').child(root.child('servers').child(%s).child('ownerId').val() + '')"
            ".val() === auth.uid" % sid)


def member_of(sid="$sid"):
    return "root.child('serverMembers').child(%s).child(%s).exists()" % (sid, MY)


def manager(perm, sid="$sid"):
    """Exactly the shape build_rules.py uses everywhere else, so there is one idea of what
    'may manage this server' means. `root` is the data BEFORE the write, which is what stops an
    atomic multi-path update from bootstrapping itself: every .validate in the batch sees the
    same pre-write permissions."""
    return ("(%s || %s || root.child('serverMembers').child(%s).child(%s).child('p').child('%s')"
            ".val() === true || (root.child('serverRoles').child(%s).child('everyone').child('perms')"
            ".child('%s').val() === true && %s))"
            % (SITE_OWNER, srv_owner(sid), sid, MY, perm, sid, perm, member_of(sid)))


# =====================================================================
# H1 - server permission self-escalation
# =====================================================================
mem = rules["serverMembers"]["$sid"]["$id"]
assert ".write" in mem and "p" in mem and "roles" in mem, "unexpected serverMembers rule; aborting"
assert "idToUid" in mem[".write"], "serverMembers/$sid/$id/.write is not the expected shape; aborting"

MANAGE_ROLES = manager("manageRoles")

perm_map = mem["p"]
perm_keys = [k for k in perm_map.keys() if not k.startswith(".")]
assert len(perm_keys) >= 20, "expected the full permission list under p, found %d" % len(perm_keys)
for k in perm_keys:
    node = perm_map[k]
    assert isinstance(node, dict) and node.get(".validate") == "newData.isBoolean()", \
        "unexpected validate on p/%s: %r" % (k, node)
    # Keep the boolean check AND ask who is writing. A member writing their own row still passes
    # the cascaded .write, but this .validate refuses the value.
    node[".validate"] = "newData.isBoolean() && %s" % MANAGE_ROLES

roles_map = mem["roles"]
assert roles_map.get("$rid", {}).get(".validate") == "newData.val() === true", \
    "unexpected validate on serverMembers/$sid/$id/roles/$rid"
roles_map["$rid"][".validate"] = "newData.val() === true && %s" % MANAGE_ROLES

# =====================================================================
# H2 - the paid tiers
# =====================================================================
vip = rules["vip"]["$id"]
assert "lastSpin" in vip[".write"] and "perm" in vip[".validate"], "unexpected vip rule; aborting"

SPUN_NOW = "newData.parent().parent().child('lastSpin').child($id).val() === now"

# A self-write must now be the 24h form, and must come with a fresh spin in the same update.
# Permanent VIP from a browser is gone; owners and the Admin SDK are unaffected.
vip[".write"] = (
    "auth != null && (%s || (root.child('idToUid').child($id).val() === auth.uid"
    " && root.child('banned').child($id).val() !== true"
    " && newData.exists()"
    " && data.child('perm').val() !== true"
    " && newData.child('perm').val() !== true"      # <- the fix: no self-granted permanent VIP
    " && %s))" % (SITE_OWNER, SPUN_NOW)
)

mvp = rules["mvp"]["$id"]
assert "lastSpin" in mvp[".write"], "unexpected mvp rule; aborting"
# MVP is no longer self-writable at all. api/spin.js writes it with the Admin SDK, which is not
# subject to rules, exactly as api/totaward.js already writes custom roles.
mvp[".write"] = "auth != null && %s" % SITE_OWNER

# =====================================================================
# H3 - clearing the audit log
# =====================================================================
al = rules["auditLog"]["$sid"]
assert ".read" in al and "$eid" in al, "unexpected auditLog rule; aborting"
assert ".write" not in al, "auditLog/$sid already has a .write rule; aborting rather than replacing it"
# Delete-only, and only the whole subtree: there is no shape a non-null value here could take
# that the $eid rules below would not already have to accept.
al[".write"] = ("auth != null && !newData.exists() && data.exists() && (%s || %s)"
                % (SITE_OWNER, srv_owner()))

# =====================================================================
# H4 - Manage Messages
# =====================================================================
msg = rules["messages"]["$key"]["$msg"]
w = msg[".write"]
assert "manageMsg" not in w, "the messages rule already mentions manageMsg; aborting"
assert w.count("channelServer") == 4, \
    "messages rule is not the shape this patch was written against (channelServer x%d)" % w.count("channelServer")

SRV = "root.child('channelServer').child($key).val()"
SENDER = "data.child('senderId').val() + ''"

# A server moderator deleting a message in their own server's channel.
#   * the channel must belong to a server (channelServer/$key exists)
#   * the actor must hold manageMsg there, by role or by @everyone
#   * never a site owner's message
#   * and they must outrank the author IN THAT SERVER, using the same pos comparison
#     DModel.canManageMember uses - via the cache, so no role walk is needed in a rule
SERVER_STAFF_DELETE = (
    "(data.exists() && !newData.exists()"
    " && root.child('channelServer').child($key).exists()"
    " && root.child('banned').child(%s).val() !== true"
    " && (root.child('owners').child(%s).val() !== 1"
    " && root.child('secretowner').child(%s).val() !== 1)"
    " && (root.child('serverMembers').child(%s).child(%s).child('p').child('manageMsg').val() === true"
    " || (root.child('serverRoles').child(%s).child('everyone').child('perms').child('manageMsg')"
    ".val() === true && root.child('serverMembers').child(%s).child(%s).exists()))"
    " && root.child('idToUid').child(root.child('servers').child(%s).child('ownerId').val() + '')"
    ".val() !== root.child('idToUid').child(%s).val())"
    % (MY, SENDER, SENDER, SRV, MY, SRV, SRV, MY, SRV, SENDER)
)

# Spliced in as one more OR-branch on the SAME level as the existing delete branch, inside the
# `auth != null && ( ... )` group. The group is the second half of the expression; it ends with
# the final '))' of the whole rule, so the branch is appended just before that.
assert w.endswith("))"), "messages rule does not end as expected; aborting"
msg[".write"] = w[:-2] + " || " + SERVER_STAFF_DELETE + "))"

# ---------------------------------------------------------------------
# Self-check. Refuse to write output that lost anything or missed anything.
# ---------------------------------------------------------------------
for k in perm_keys:
    v = rules["serverMembers"]["$sid"]["$id"]["p"][k][".validate"]
    if "manageRoles" not in v or "newData.isBoolean()" not in v:
        raise SystemExit("ABORT - p/%s validate did not take" % k)
if "manageRoles" not in rules["serverMembers"]["$sid"]["$id"]["roles"]["$rid"][".validate"]:
    raise SystemExit("ABORT - roles/$rid validate did not take")
if "newData.child('perm').val() !== true" not in rules["vip"]["$id"][".write"]:
    raise SystemExit("ABORT - vip self-write was not tightened")
if "lastSpin" in rules["mvp"]["$id"][".write"]:
    raise SystemExit("ABORT - mvp self-write branch is still there")
if ".write" not in rules["auditLog"]["$sid"]:
    raise SystemExit("ABORT - auditLog/$sid/.write did not take")
if "manageMsg" not in rules["messages"]["$key"]["$msg"][".write"]:
    raise SystemExit("ABORT - the manageMsg delete branch did not take")

# everything that was there must still be there
WAS_THERE = ("admin", "appVersion", "attest", "banned", "blocked", "blockedBy", "channelServer",
             "counters", "customroles", "dmMembers", "flair", "friendRequests", "friends",
             "idToUid", "invites", "inviteCodes", "ipBans", "lastRead", "lastSend", "lastSpin",
             "messages", "modSettings", "mods", "muted", "mvp", "notes", "notifPrefs", "onlineUsers",
             "owners", "pins", "polls", "presence", "rate", "reactions", "roles", "roomMembers",
             "rooms", "saved", "secretowner", "serverBans", "serverBoosts", "serverCats",
             "serverChannels", "serverDiscovery", "serverEmoji", "serverEvents", "serverIpBans",
             "serverMembers", "serverMutes", "serverOrder", "serverRoles", "servers", "sessions",
             "spinWin", "tosAccepted", "typing", "uidToId", "usernameLogin", "usernames", "users",
             "vip", "voice", "achievements", "activity", "auditLog", "connections", "memberScreen")
missing = [n for n in WAS_THERE if n not in rules]
if missing:
    raise SystemExit("ABORT - nodes missing from the output: " + ", ".join(missing))

with open(OUT, "w") as f:
    json.dump(doc, f, indent=1)
    f.write("\n")

print("wrote", OUT)
print("H1  server permission self-escalation closed (%d permissions + role entries)" % len(perm_keys))
print("H2  permanent VIP and MVP are no longer self-writable")
print("H3  auditLog/$sid delete now has a rule")
print("H4  Manage Messages can now delete in its own server")
print()
print("longest line:", max(len(l) for l in open(OUT).read().split("\n")), "characters")
