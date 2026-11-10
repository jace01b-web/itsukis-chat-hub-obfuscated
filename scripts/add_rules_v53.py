#!/usr/bin/env python3
"""
Adds the v53 nodes/fields to firebase-rules.json, in place and additively.

    python3 scripts/add_rules_v53.py firebase-rules.json firebase-rules.json

Why additive and not a regenerate: scripts/build_rules.py needs the ORIGINAL pre-Discord ruleset
as its input, and that file is not in the repo any more - firebase-rules.json is its output. This
script therefore takes the shipped rules and adds only what v53 needs, asserting the shape of
everything it touches first so it can never silently weaken an existing rule.

What it adds:
  users/$id/style/displayName     Discord-style display name (public half of a profile)
  servers/$sid/desc               server description (server settings -> Overview)
  servers/$sid/sys                system channel id - where join messages are posted
  servers/$sid/welcome            send a join message when someone joins (bool)
  servers/$sid/wjoin              "random welcome wording" toggle (bool)
  servers/$sid/banner             server banner image (boost perk, same validation as icons)
  serverBoosts/$sid/$uid/$slot    who is boosting a server, and since when
  userBoosts/$uid/$slot           which server each of your boost slots points at
"""
import json, sys, collections

SRC = sys.argv[1] if len(sys.argv) > 1 else "firebase-rules.json"
OUT = sys.argv[2] if len(sys.argv) > 2 else SRC

with open(SRC) as f:
    doc = json.load(f, object_pairs_hook=collections.OrderedDict)
rules = doc["rules"]

MY = "root.child('uidToId').child(auth.uid).val() + ''"
AUTHED = "auth != null && root.child('uidToId').child(auth.uid).exists()"
IS_MVP = "root.child('mvp').child(%s).exists()" % MY
SITE_OWNER = ("(root.child('owners').child(%s).val() === 1 || "
              "root.child('secretowner').child(%s).val() === 1)" % (MY, MY))

D = collections.OrderedDict


def insert_before_other(node, path, additions):
    """Add validated leaves to a node that ends in `$other: {".validate": false}`, keeping
    $other last. Refuses if the node is not the shape we expect."""
    assert node.get("$other", {}).get(".validate") is False, "unexpected %s rule; aborting" % path
    out = D()
    for k, v in node.items():
        if k == "$other":
            for nk, nv in additions.items():
                if nk not in node:
                    out[nk] = nv
        out[k] = v
    return out


# =====================================================================
# 1. users/$id/style/displayName
#    Public, like the avatar and the status. 32 chars is Discord's own cap. Empty string means
#    "no display name" - fall back to the username - so clearing one is always allowed.
# =====================================================================
rules["users"]["$id"]["style"] = insert_before_other(
    rules["users"]["$id"]["style"], "users/$id/style",
    D([("displayName", D([(".validate",
         "newData.isString() && newData.val().length <= 32")]))]))

# =====================================================================
# 2. servers/$sid extra fields
#    The .write rule on servers/$sid is untouched, so exactly the same people can write these as
#    could already rename the server.
# =====================================================================
rules["servers"]["$sid"] = insert_before_other(
    rules["servers"]["$sid"], "servers/$sid",
    D([
        ("desc",    D([(".validate", "newData.isString() && newData.val().length <= 300")])),
        ("sys",     D([(".validate", "newData.isString() && newData.val().length <= 64")])),
        ("welcome", D([(".validate", "newData.isBoolean()")])),
        ("wjoin",   D([(".validate", "newData.isBoolean()")])),
        ("banner",  D([(".validate",
            "newData.isString() && (newData.val() === '' || (newData.val().length <= 400000 && "
            "(newData.val().beginsWith('data:image/jpeg;base64,') || "
            "newData.val().beginsWith('data:image/png;base64,') || "
            "newData.val().beginsWith('data:image/webp;base64,'))))")])),
    ]))

# =====================================================================
# 3. Boosts
#    Two mirrored nodes, both written only by the booster themselves:
#      serverBoosts/$sid/$uid/$slot   - so a server can count its boosts in one read
#      userBoosts/$uid/$slot          - so you can see where your own slots are pointed
#    A slot can always be REMOVED (that is how you move or give one up, and how an account that
#    lost MVP tidies up). Creating one requires MVP at the moment of the write.
#    The 7-day move cooldown is enforced in the browser, like the server caps are: rules cannot
#    compare against a node this write is deleting.
# =====================================================================
BOOST_WRITE = ("%s && $uid === %s && (!newData.exists() || %s)" % (AUTHED, MY, IS_MVP))

if "serverBoosts" not in rules:
    rules["serverBoosts"] = D([
        ("$sid", D([
            (".read", AUTHED),
            ("$uid", D([
                (".write", BOOST_WRITE),
                ("$slot", D([
                    (".validate", "$slot.matches(/^[01]$/) && newData.hasChildren(['at'])"),
                    ("at", D([(".validate", "newData.isNumber()")])),
                    ("$other", D([(".validate", False)])),
                ])),
            ])),
        ])),
    ])

if "userBoosts" not in rules:
    rules["userBoosts"] = D([
        ("$uid", D([
            (".read", AUTHED),
            (".write", BOOST_WRITE),
            ("$slot", D([
                (".validate", "$slot.matches(/^[01]$/) && newData.hasChildren(['sid','at'])"),
                ("sid", D([(".validate", "newData.isString() && newData.val().length <= 64")])),
                ("at",  D([(".validate", "newData.isNumber()")])),
                ("$other", D([(".validate", False)])),
            ])),
        ])),
    ])

# =====================================================================
# 4. Deleting a server must take its boosts with it, the same way it already takes its bans,
#    mutes and Discover listing. That is a client-side patch (DModel.deleteServer), not a rule -
#    nothing to assert here, but the self-check below makes sure the nodes exist to delete.
# =====================================================================

# =====================================================================
# 4b. System messages (join notices, boost notices).
#
#     A system message is an ordinary message with one extra field, `sys`, naming what happened.
#     It is written by the person it is about - the joiner writes their own join notice - so it
#     needs no new write rule: the existing branch already requires the author to be a member of
#     the channel, which joining has just made true. `text` still carries a plain-words fallback,
#     so a client that does not know about `sys` shows a sensible line rather than nothing.
# =====================================================================
rules["messages"]["$key"]["$msg"] = insert_before_other(
    rules["messages"]["$key"]["$msg"], "messages/$key/$msg",
    D([("sys", D([(".validate",
         "newData.isString() && newData.val().matches(/^(join|boost)$/)")]))]))

# =====================================================================
# 5. SURGICAL EDIT: the message-delete ladder.
#
#    The delete branch of messages/$key/$msg/.write tested only the ranks ABOVE the actor, never
#    the actor's own, so:
#       - an admin could delete another ADMIN's message
#       - a mod could delete another MOD's message
#    Each branch gains the one missing test. Nothing else about the rule changes, and the
#    "it's my own message" branch earlier in the same OR is untouched, so deleting your own is
#    unaffected whatever rank you hold.
# =====================================================================
SENDER = "data.child('senderId').val() + ''"
ME_UID = "root.child('uidToId').child(auth.uid).val() + ''"

msg_w = rules["messages"]["$key"]["$msg"][".write"]

MOD_BRANCH = (
    "root.child('mods').child(%s).val() === 1"
    " && root.child('banned').child(%s).val() !== true"
    " && (root.child('owners').child(%s).val() !== 1"
    " && root.child('secretowner').child(%s).val() !== 1)"
    " && root.child('admin').child(%s).val() !== 1"
) % (ME_UID, ME_UID, SENDER, SENDER, SENDER)

ADMIN_BRANCH = (
    "root.child('admin').child(%s).val() === 1"
    " && root.child('banned').child(%s).val() !== true"
    " && (root.child('owners').child(%s).val() !== 1"
    " && root.child('secretowner').child(%s).val() !== 1)"
) % (ME_UID, ME_UID, SENDER, SENDER)

if msg_w.count(MOD_BRANCH) != 1:
    raise SystemExit("ABORT - could not find the mod delete branch exactly once (found %d)"
                     % msg_w.count(MOD_BRANCH))
# Patch the admin branch FIRST: ADMIN_BRANCH is a substring of nothing else, but the mod branch
# ends with an `admin` test whose text would otherwise be disturbed by the admin patch.
if msg_w.count(ADMIN_BRANCH) != 1:
    raise SystemExit("ABORT - could not find the admin delete branch exactly once (found %d)"
                     % msg_w.count(ADMIN_BRANCH))

msg_w = msg_w.replace(
    MOD_BRANCH,
    MOD_BRANCH + " && root.child('mods').child(%s).val() !== 1" % SENDER)
msg_w = msg_w.replace(
    ADMIN_BRANCH,
    ADMIN_BRANCH + " && root.child('admin').child(%s).val() !== 1" % SENDER)
rules["messages"]["$key"]["$msg"][".write"] = msg_w

# ---------------------------------------------------------------------
# Self-check: refuse to write output that is missing anything this script is supposed to add,
# and make sure nothing that was already there was dropped on the way through.
for node in ("servers", "users", "serverBoosts", "userBoosts", "serverMembers",
             "serverChannels", "serverRoles", "messages", "roomMembers"):
    if node not in rules:
        raise SystemExit("ABORT - node missing from output: " + node)
if "displayName" not in rules["users"]["$id"]["style"]:
    raise SystemExit("ABORT - users/style/displayName did not make it in")
if "status" not in rules["users"]["$id"]["style"]:
    raise SystemExit("ABORT - users/style lost its presence status fields")
if "sys" not in rules["messages"]["$key"]["$msg"]:
    raise SystemExit("ABORT - messages/$key/$msg/sys did not make it in")
for f in ("senderId", "at", "text", "images", "files", "pings", "replyTo"):
    if f not in rules["messages"]["$key"]["$msg"]:
        raise SystemExit("ABORT - messages lost its original field: " + f)
for f in ("desc", "sys", "welcome", "banner"):
    if f not in rules["servers"]["$sid"]:
        raise SystemExit("ABORT - servers/$sid/%s did not make it in" % f)
for f in ("name", "ownerId", "createdAt", "icon", "img"):
    if f not in rules["servers"]["$sid"]:
        raise SystemExit("ABORT - servers/$sid lost its original field: " + f)
if rules["servers"]["$sid"].get("$other", {}).get(".validate") is not False:
    raise SystemExit("ABORT - servers/$sid lost its $other guard")
if rules["users"]["$id"]["style"].get("$other", {}).get(".validate") is not False:
    raise SystemExit("ABORT - users/$id/style lost its $other guard")

with open(OUT, "w") as f:
    json.dump(doc, f, indent=1)
    f.write("\n")

print("wrote", OUT)
print("top-level nodes:", len(rules))
print("added: serverBoosts, userBoosts")
print("added fields: users/$id/style/displayName; servers/$sid/{desc,sys,welcome,wjoin,banner}")
