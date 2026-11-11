#!/usr/bin/env python3
"""
Adds the v54 nodes/fields to firebase-rules.json, in place and additively.

    python3 scripts/add_rules_v54.py firebase-rules.json firebase-rules.json

Same approach as scripts/add_rules_v53.py and for the same reason: build_rules.py needs the
original pre-Discord ruleset as its input and that file is not in the repo any more, so v54 takes
the shipped rules and ADDS to them, asserting the shape of everything it touches first. It never
rewrites or relaxes an existing rule. If any assertion fails nothing is written.

WHAT IT ADDS

  users/$id/style/accent        profile accent colour (public half of a profile)
  users/$id/style/theme         profile theme preset id
  users/$id/style/deco          avatar decoration id

  servers/$sid/srules           the server's rules text (rules screening)
  servers/$sid/screenOn         require new members to accept the rules before talking
  servers/$sid/wtitle           welcome screen heading
  servers/$sid/wdesc            welcome screen blurb
  servers/$sid/verify           verification level: none|low|med|high
  servers/$sid/efilter          explicit content filter: off|members|all
  servers/$sid/defNotif         default notification level: all|mentions

  serverRoles/$sid/$rid/desc    role description
  serverRoles/$sid/$rid/icon    role icon (one emoji)

  three new permissions, in both places a permission is spelled out:
    serverRoles/$sid/$rid/perms/{manageEmoji,manageEvents,viewAudit}
    serverMembers/$sid/$id/p/{manageEmoji,manageEvents,viewAudit}

  activity/$id                  rich presence - what someone is listening to / playing
  notes/$uid/$target            private per-user notes (only the author can read them)
  auditLog/$sid/$eid            append-only server audit log
  serverEvents/$sid/$eid        scheduled server events, with RSVPs
  serverEmoji/$sid/$eid         custom server emoji
  memberScreen/$sid/$uid        who has accepted a server's rules
  polls/$key/$msg               poll definitions and votes
  saved/$uid/$sid               saved messages / bookmarks
  connections/$uid/$cid         connected accounts shown on a profile
  notifPrefs/$uid/$scope/$id    per-server and per-channel notification overrides
  achievements/$uid/$aid        achievements earned

HONEST LIMITATIONS, written down so nobody assumes otherwise

  * The audit log is written by the client that performed the action, because Realtime Database
    rules cannot observe one write and record another. Rules force `by` to be the signed-in
    account and make entries append-only, so an entry can never be forged as SOMEBODY ELSE and
    can never be edited after the fact - but a member could still write an entry about an action
    they did not take. Treat it as a staff-visible record, not as proof.
  * Achievements are written by the earner's own client, so they are cosmetic. Nothing is gated
    behind one.
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
NOT_BANNED = "root.child('banned').child(%s).val() !== true" % MY


def srv_owner(sid="$sid"):
    return "root.child('idToUid').child(root.child('servers').child(%s).child('ownerId').val() + '').val() === auth.uid" % sid


def member_of(sid="$sid"):
    return "root.child('serverMembers').child(%s).child(%s).exists()" % (sid, MY)


def manager(perm, sid="$sid"):
    """The same shape build_rules.py uses: site owner, or the server's owner, or the flattened
    permission cache, or @everyone carrying the permission and you being a member.
    Administrator is NOT re-derived here - the client's cache already expands it into every
    individual permission, which is why build_rules.py stopped testing it separately."""
    return ("(%s || %s || (root.child('serverMembers').child(%s).child(%s).child('p').child('%s')"
            ".val() === true || (root.child('serverRoles').child(%s).child('everyone').child('perms')"
            ".child('%s').val() === true && %s)))"
            % (SITE_OWNER, srv_owner(sid), sid, MY, perm, sid, perm, member_of(sid)))


def insert_before_other(node, path, additions):
    """Add validated leaves to a node ending in `$other: {".validate": false}`, keeping $other
    last. Refuses outright if the node is not the shape we expect."""
    assert node.get("$other", {}).get(".validate") is False, "unexpected %s rule; aborting" % path
    out = D()
    for k, v in node.items():
        if k == "$other":
            for nk, nv in additions.items():
                if nk not in node:
                    out[nk] = nv
        out[k] = v
    return out


def add_leaves(node, path, additions):
    """Add validated leaves to a node that has NO $other guard (every child is enumerated and an
    unlisted child is simply unvalidated). Used for the two permission maps."""
    assert "$other" not in node, "unexpected %s rule (has $other); aborting" % path
    for nk, nv in additions.items():
        if nk not in node:
            node[nk] = nv
    return node


def V(expr):
    return D([(".validate", expr)])


def STR(maxlen):
    return V("newData.isString() && newData.val().length <= %d" % maxlen)


def BOOL():
    return V("newData.isBoolean()")


def NUM():
    return V("newData.isNumber()")


def ENUM(*vals):
    return V("newData.isString() && newData.val().matches(/^(%s)$/)" % "|".join(vals))


HEX = V("newData.isString() && (newData.val() === '' || newData.val().matches(/^#[0-9a-fA-F]{3,8}$/))")

# =====================================================================
# 1. users/$id/style - three more public profile fields.
#    The .write rule on users/$id is untouched, so exactly the same people can write these as
#    could already change the avatar: the account itself.
# =====================================================================
rules["users"]["$id"]["style"] = insert_before_other(
    rules["users"]["$id"]["style"], "users/$id/style",
    D([
        ("accent", HEX),
        ("theme", STR(24)),
        ("deco", STR(32)),
    ]))

# =====================================================================
# 2. servers/$sid - the welcome screen, rules screening and the three moderation levels.
#    Again the node's own .write rule is untouched, so these are writable by whoever could
#    already rename the server.
# =====================================================================
rules["servers"]["$sid"] = insert_before_other(
    rules["servers"]["$sid"], "servers/$sid",
    D([
        ("srules", STR(2000)),
        ("screenOn", BOOL()),
        ("wtitle", STR(100)),
        ("wdesc", STR(300)),
        ("verify", ENUM("none", "low", "med", "high")),
        ("efilter", ENUM("off", "members", "all")),
        ("defNotif", ENUM("all", "mentions")),
    ]))

# =====================================================================
# 3. serverRoles/$sid/$rid - role description and icon.
#    This node enumerates its children and has no $other guard, so unlisted children are
#    currently unvalidated; naming these two means they get a length cap.
# =====================================================================
role_node = rules["serverRoles"]["$sid"]["$rid"]
assert "name" in role_node and "pos" in role_node, "unexpected serverRoles/$sid/$rid rule; aborting"
if "desc" not in role_node:
    role_node["desc"] = STR(120)
if "icon" not in role_node:
    role_node["icon"] = STR(8)

# =====================================================================
# 4. Three new permissions.
#    A permission is spelled out in TWO places and both must agree, or the write is refused:
#      serverRoles/$sid/$rid/perms/<k>  - the role's own switch
#      serverMembers/$sid/$id/p/<k>     - the flattened cache the rules actually read
#    Nothing reads these yet beyond the nodes added further down, so adding them cannot change
#    the behaviour of any existing permission.
# =====================================================================
NEW_PERMS = D([("manageEmoji", BOOL()), ("manageEvents", BOOL()), ("viewAudit", BOOL())])

role_perms = role_node.get("perms")
assert isinstance(role_perms, dict) and "manageMsg" in role_perms, \
    "unexpected serverRoles/$sid/$rid/perms rule; aborting"
role_node["perms"] = add_leaves(role_perms, "serverRoles/$sid/$rid/perms", NEW_PERMS)

mem_p = rules["serverMembers"]["$sid"]["$id"].get("p")
assert isinstance(mem_p, dict) and "manageMsg" in mem_p and ".write" in mem_p, \
    "unexpected serverMembers/$sid/$id/p rule; aborting"
rules["serverMembers"]["$sid"]["$id"]["p"] = add_leaves(
    mem_p, "serverMembers/$sid/$id/p", NEW_PERMS)

# =====================================================================
# 5. activity/$id - rich presence.
#    Public, like the presence status: everyone who can see a profile can see what the person is
#    listening to. Written only by that account, and only about itself.
# =====================================================================
if "activity" not in rules:
    rules["activity"] = D([
        (".read", AUTHED),
        ("$id", D([
            (".write", "%s && $id === %s" % (AUTHED, MY)),
            (".validate", "!newData.exists() || newData.hasChildren(['kind', 'name', 'at'])"),
            ("kind", ENUM("listening", "playing", "watching", "streaming")),
            ("name", STR(80)),
            ("detail", STR(80)),
            ("at", NUM()),
            ("$other", D([(".validate", False)])),
        ])),
    ])

# =====================================================================
# 6. notes/$uid/$target - the private note you can keep on someone.
#    Discord's notes are visible only to their author, so this node is readable only by its
#    owner. Nobody else - not a mod, not an owner - can read your notes, which is the point.
# =====================================================================
if "notes" not in rules:
    rules["notes"] = D([
        ("$uid", D([
            (".read", "%s && $uid === %s" % (AUTHED, MY)),
            (".write", "%s && $uid === %s" % (AUTHED, MY)),
            ("$target", STR(400)),
        ])),
    ])

# =====================================================================
# 7. auditLog/$sid/$eid - append-only server audit log.
#
#    Read: anyone with View Audit Log in that server (or its owner, or a site owner).
#    Write: a member of the server, creating a NEW entry whose `by` is themselves. Existing
#    entries can never be changed. Only the server's owner (or a site owner) can delete, which
#    is what "clear the log" does.
#
#    See the limitation note at the top of this file: this records what a client SAYS it did.
# =====================================================================
if "auditLog" not in rules:
    rules["auditLog"] = D([
        ("$sid", D([
            (".read", "%s && %s" % (AUTHED, manager("viewAudit"))),
            ("$eid", D([
                (".write",
                 "%s && %s && ((!data.exists() && newData.exists() && %s) || "
                 "(!newData.exists() && (%s || %s)))"
                 % (AUTHED, NOT_BANNED, member_of(), SITE_OWNER, srv_owner())),
                (".validate",
                 "!newData.exists() || (newData.hasChildren(['by', 'at', 'act']) && "
                 "newData.child('by').val() + '' === %s)" % MY),
                ("by", NUM()),
                ("at", NUM()),
                ("act", STR(32)),
                ("target", STR(64)),
                ("name", STR(80)),
                ("reason", STR(200)),
                ("extra", STR(200)),
                ("$other", D([(".validate", False)])),
            ])),
        ])),
    ])

# =====================================================================
# 8. serverEvents/$sid/$eid - scheduled events.
#    The event itself needs Manage Events. The RSVP list is a separate child so that an ordinary
#    member can mark themselves interested without being able to touch the event.
# =====================================================================
if "serverEvents" not in rules:
    rules["serverEvents"] = D([
        ("$sid", D([
            (".read", AUTHED),
            ("$eid", D([
                (".write", "%s && %s && %s" % (AUTHED, NOT_BANNED, manager("manageEvents"))),
                (".validate",
                 "!newData.exists() || newData.hasChildren(['name', 'at', 'by'])"),
                ("name", STR(80)),
                ("desc", STR(500)),
                ("at", NUM()),
                ("ends", NUM()),
                ("by", NUM()),
                ("made", NUM()),
                ("where", STR(80)),
                ("ch", STR(64)),
                ("rsvp", D([
                    ("$uid", D([
                        (".write", "%s && $uid === %s && %s" % (AUTHED, MY, member_of())),
                        (".validate", "!newData.exists() || newData.val() === true"),
                    ])),
                ])),
                ("$other", D([(".validate", False)])),
            ])),
        ])),
    ])

# =====================================================================
# 9. serverEmoji/$sid/$eid - custom emoji.
#    Readable by everyone signed in, because an emoji posted in a message has to render for
#    whoever is reading it. Images are validated exactly like server icons and avatars are.
# =====================================================================
IMG_OK = ("newData.isString() && newData.val().length <= 120000 && "
          "(newData.val().beginsWith('data:image/jpeg;base64,') || "
          "newData.val().beginsWith('data:image/png;base64,') || "
          "newData.val().beginsWith('data:image/webp;base64,') || "
          "newData.val().beginsWith('data:image/gif;base64,'))")

if "serverEmoji" not in rules:
    rules["serverEmoji"] = D([
        (".read", AUTHED),
        ("$sid", D([
            ("$eid", D([
                (".write", "%s && %s && %s" % (AUTHED, NOT_BANNED, manager("manageEmoji"))),
                (".validate", "!newData.exists() || newData.hasChildren(['name', 'img'])"),
                ("name", V("newData.isString() && newData.val().matches(/^[a-zA-Z0-9_]{2,32}$/)")),
                ("img", V(IMG_OK)),
                ("by", NUM()),
                ("at", NUM()),
                ("$other", D([(".validate", False)])),
            ])),
        ])),
    ])

# =====================================================================
# 10. memberScreen/$sid/$uid - who has accepted a server's rules.
#     Written only by the person accepting, for themselves. Readable by anyone signed in so the
#     server's staff can see who is still pending.
# =====================================================================
if "memberScreen" not in rules:
    rules["memberScreen"] = D([
        ("$sid", D([
            (".read", AUTHED),
            ("$uid", D([
                (".write", "%s && ($uid === %s || %s || %s)" % (AUTHED, MY, SITE_OWNER, srv_owner())),
                (".validate", "!newData.exists() || newData.isNumber()"),
            ])),
        ])),
    ])

# =====================================================================
# 11. polls/$key/$msg - a poll attached to a message.
#     `q` (the question and its options) is written by whoever wrote the message, which is read
#     straight off the message itself, so a poll can never be attached to somebody else's post.
#     `v/$uid` (a vote) is written only by the voter. Staff who can delete the message can also
#     delete the poll, so a removed message does not leave an orphan behind.
# =====================================================================
MSG_AUTHOR = ("root.child('messages').child($key).child($msg).child('senderId').val() + '' === %s" % MY)

if "polls" not in rules:
    rules["polls"] = D([
        ("$key", D([
            (".read", AUTHED),
            ("$msg", D([
                ("q", D([
                    (".write", "%s && %s && (%s || (!newData.exists() && %s))"
                     % (AUTHED, NOT_BANNED, MSG_AUTHOR, SITE_OWNER)),
                    (".validate", "!newData.exists() || newData.hasChildren(['text', 'opts'])"),
                    ("text", STR(200)),
                    ("multi", BOOL()),
                    ("ends", NUM()),
                    ("at", NUM()),
                    ("opts", D([
                        ("$i", D([
                            (".validate",
                             "$i.matches(/^[0-9]$/) && newData.isString() && "
                             "newData.val().length >= 1 && newData.val().length <= 80"),
                        ])),
                    ])),
                    ("$other", D([(".validate", False)])),
                ])),
                ("v", D([
                    ("$uid", D([
                        (".write", "%s && $uid === %s && %s" % (AUTHED, MY, NOT_BANNED)),
                        (".validate",
                         "!newData.exists() || (newData.isString() && "
                         "newData.val().matches(/^[0-9](,[0-9]){0,9}$/))"),
                    ])),
                ])),
            ])),
        ])),
    ])

# =====================================================================
# 12. saved/$uid/$sid - saved messages (bookmarks). Yours alone, both ways.
# =====================================================================
if "saved" not in rules:
    rules["saved"] = D([
        ("$uid", D([
            (".read", "%s && $uid === %s" % (AUTHED, MY)),
            (".write", "%s && $uid === %s" % (AUTHED, MY)),
            ("$sid", D([
                (".validate", "!newData.exists() || newData.hasChildren(['key', 'msg', 'at'])"),
                ("key", STR(64)),
                ("msg", STR(64)),
                ("at", NUM()),
                ("by", NUM()),
                ("text", STR(300)),
                ("$other", D([(".validate", False)])),
            ])),
        ])),
    ])

# =====================================================================
# 13. connections/$uid/$cid - the accounts someone chooses to show on their profile.
#     Public, because that is what a connection is for; `hide` lets them keep one private, which
#     every client honours. Written only by the account itself.
# =====================================================================
if "connections" not in rules:
    rules["connections"] = D([
        (".read", AUTHED),
        ("$uid", D([
            (".write", "%s && $uid === %s" % (AUTHED, MY)),
            ("$cid", D([
                (".validate", "!newData.exists() || newData.hasChildren(['kind', 'name'])"),
                ("kind", V("newData.isString() && newData.val().matches(/^[a-z0-9]{2,16}$/)")),
                ("name", STR(60)),
                ("url", V("newData.isString() && (newData.val() === '' || "
                          "(newData.val().length <= 200 && newData.val().beginsWith('https://')))")),
                ("hide", BOOL()),
                ("at", NUM()),
                ("$other", D([(".validate", False)])),
            ])),
        ])),
    ])

# =====================================================================
# 14. notifPrefs/$uid/$scope/$id - per-server and per-channel notification overrides.
#     These could not live in users/$id/settings: that node only accepts scalar values, and this
#     is a map. Private to the account, like lastRead is.
# =====================================================================
if "notifPrefs" not in rules:
    rules["notifPrefs"] = D([
        ("$uid", D([
            (".read", "%s && $uid === %s" % (AUTHED, MY)),
            (".write", "%s && $uid === %s" % (AUTHED, MY)),
            ("$scope", D([
                (".validate", "$scope.matches(/^(srv|ch)$/)"),
                ("$id", STR(16)),
            ])),
        ])),
    ])

# =====================================================================
# 15. achievements/$uid/$aid - earned achievements. Cosmetic; see the note at the top.
# =====================================================================
if "achievements" not in rules:
    rules["achievements"] = D([
        (".read", AUTHED),
        ("$uid", D([
            (".write", "%s && $uid === %s" % (AUTHED, MY)),
            ("$aid", D([
                (".validate",
                 "!newData.exists() || ($aid.matches(/^[a-z0-9_]{2,32}$/) && newData.isNumber())"),
            ])),
        ])),
    ])

# ---------------------------------------------------------------------
# Self-check. Refuse to write output that is missing anything this script is supposed to add, or
# that has lost anything that was already there. The same guard add_rules_v53.py grew after a
# block of nodes was deleted by accident and the build still produced a plausible-looking file.
# ---------------------------------------------------------------------
WAS_THERE = ("admin", "appVersion", "attest", "banned", "blocked", "blockedBy", "channelServer",
             "counters", "customroles", "dmMembers", "flair", "friendRequests", "friends",
             "idToUid", "invites", "inviteCodes", "ipBans", "lastRead", "messages", "modSettings",
             "mods", "muted", "mvp", "onlineUsers", "owners", "pins", "presence", "rate",
             "reactions", "roles", "roomMembers", "rooms", "secretowner", "serverBans",
             "serverBoosts", "serverCats", "serverChannels", "serverDiscovery", "serverIpBans",
             "serverMembers", "serverMutes", "serverOrder", "serverRoles", "servers", "sessions",
             "typing", "uidToId", "userBoosts", "userServers", "usernames", "users", "vip", "voice")
for node in WAS_THERE:
    if node not in rules:
        raise SystemExit("ABORT - a node that was already there is missing from the output: " + node)

ADDED = ("activity", "notes", "auditLog", "serverEvents", "serverEmoji", "memberScreen",
         "polls", "saved", "connections", "notifPrefs", "achievements")
for node in ADDED:
    if node not in rules:
        raise SystemExit("ABORT - node did not make it in: " + node)

for f in ("accent", "theme", "deco"):
    if f not in rules["users"]["$id"]["style"]:
        raise SystemExit("ABORT - users/$id/style/%s did not make it in" % f)
for f in ("displayName", "status", "customStatus", "avatar", "banner", "pronouns", "description"):
    if f not in rules["users"]["$id"]["style"]:
        raise SystemExit("ABORT - users/$id/style lost its original field: " + f)
if rules["users"]["$id"]["style"].get("$other", {}).get(".validate") is not False:
    raise SystemExit("ABORT - users/$id/style lost its $other guard")

for f in ("srules", "screenOn", "wtitle", "wdesc", "verify", "efilter", "defNotif"):
    if f not in rules["servers"]["$sid"]:
        raise SystemExit("ABORT - servers/$sid/%s did not make it in" % f)
for f in ("name", "ownerId", "createdAt", "icon", "img", "desc", "sys", "welcome", "banner"):
    if f not in rules["servers"]["$sid"]:
        raise SystemExit("ABORT - servers/$sid lost its original field: " + f)
if rules["servers"]["$sid"].get("$other", {}).get(".validate") is not False:
    raise SystemExit("ABORT - servers/$sid lost its $other guard")

for f in ("desc", "icon"):
    if f not in rules["serverRoles"]["$sid"]["$rid"]:
        raise SystemExit("ABORT - serverRoles/$sid/$rid/%s did not make it in" % f)
for k in ("manageEmoji", "manageEvents", "viewAudit"):
    if k not in rules["serverRoles"]["$sid"]["$rid"]["perms"]:
        raise SystemExit("ABORT - role perm %s did not make it in" % k)
    if k not in rules["serverMembers"]["$sid"]["$id"]["p"]:
        raise SystemExit("ABORT - member perm cache %s did not make it in" % k)
for k in ("admin", "view", "manageCh", "manageRoles", "manageSrv", "invite", "changeNick",
          "manageNick", "kick", "ban", "timeout", "send", "files", "react", "history",
          "mentionAll", "manageMsg", "voiceJoin", "voiceSpeak", "voiceMute"):
    if k not in rules["serverRoles"]["$sid"]["$rid"]["perms"]:
        raise SystemExit("ABORT - role perms lost an original permission: " + k)
    if k not in rules["serverMembers"]["$sid"]["$id"]["p"]:
        raise SystemExit("ABORT - member perm cache lost an original permission: " + k)
if ".write" not in rules["serverMembers"]["$sid"]["$id"]["p"]:
    raise SystemExit("ABORT - serverMembers/$sid/$id/p lost its .write rule")

# the v53 edits must survive untouched
if "sys" not in rules["messages"]["$key"]["$msg"]:
    raise SystemExit("ABORT - messages/$key/$msg/sys (v53) is gone")
if "ch" not in rules["voice"]["members"]["$id"]:
    raise SystemExit("ABORT - voice/members/$id/ch (v53) is gone")

with open(OUT, "w") as f:
    json.dump(doc, f, indent=1)
    f.write("\n")

print("wrote", OUT)
print("top-level nodes:", len(rules))
print("added nodes:", ", ".join(ADDED))
print("added fields: users/$id/style/{accent,theme,deco}; "
      "servers/$sid/{srules,screenOn,wtitle,wdesc,verify,efilter,defNotif}; "
      "serverRoles/$sid/$rid/{desc,icon}; 3 new permissions in both permission maps")
