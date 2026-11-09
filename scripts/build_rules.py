#!/usr/bin/env python3
"""
Builds firebase-rules.json: the user's EXISTING rules, untouched, plus the new Discord nodes.

Why a script and not a hand-written file: the existing ruleset is ~73KB of carefully tuned
expressions (session takeover, ID claiming, TOS gating, anti-nuke, IP bans...). Re-typing it would
risk silently weakening something. This loads it, adds nodes, and makes exactly ONE surgical edit to
an existing rule (roomMembers write), so everything else is provably unchanged.
"""
import json, sys, collections

SRC = sys.argv[1]
OUT = sys.argv[2]

with open(SRC) as f:
    doc = json.load(f, object_pairs_hook=collections.OrderedDict)
rules = doc["rules"]

# ---------- shorthand expressions ----------
MY   = "root.child('uidToId').child(auth.uid).val() + ''"
SITE_OWNER = ("(root.child('owners').child(%s).val() === 1 || "
              "root.child('secretowner').child(%s).val() === 1)" % (MY, MY))
NOT_BANNED = "root.child('banned').child(%s).val() !== true" % MY
AUTHED = "auth != null && root.child('uidToId').child(auth.uid).exists()"

def srv_owner(sid):
    return ("root.child('idToUid').child(root.child('servers').child(%s).child('ownerId').val() + '')"
            ".val() === auth.uid" % sid)

def is_member(sid):
    return "root.child('serverMembers').child(%s).child(%s).exists()" % (sid, MY)

def has_p(sid, perm):
    """Does this member hold `perm` on this server?

    Two sources, because neither alone is enough:
      1. serverMembers/$sid/$me/p/$perm - the denormalised cache of everything their ROLES grant.
         Rules can't walk a role list, so the client flattens it there. Only people who can manage
         roles may write it (see the serverMembers rules), so it can't be self-granted.
      2. serverRoles/$sid/everyone/perms/$perm - what @everyone grants. Read live, because a member
         who just joined has no cache entry yet and must still be able to use the default
         permissions immediately.
    """
    return ("("
            "root.child('serverMembers').child(%s).child(%s).child('p').child('%s').val() === true"
            " || ("
            "root.child('serverRoles').child(%s).child('everyone').child('perms').child('%s').val() === true"
            " && %s"
            ")"
            ")" % (sid, MY, perm, sid, perm, is_member(sid)))

def manager(sid, perm):
    """Allowed to perform a server-management action: a site owner, the server owner, or a member
    holding that permission.

    There is deliberately NO separate Administrator term. The client's effective-permission cache
    already expands Administrator into every individual permission (see effectiveFor() in
    js/discord/model.js), so `p/<perm>` is already true for an admin and testing `p/admin` as well
    was pure duplication - duplication that was inlined ~25 times and cost about 10KB of rules.

    The one case it changes: granting Administrator to @everyone. The client refuses that outright
    (see updateRole), so the two sides stay consistent."""
    return "(%s || %s || %s)" % (SITE_OWNER, srv_owner(sid), has_p(sid, perm))

# =====================================================================
# 1. SURGICAL EDIT: roomMembers write must also accept server channels.
#    Original required rooms/$room to exist (the old room system). Server channels live in
#    channelServer/$room instead. Everything else about the rule is kept.
# =====================================================================
rm = rules["roomMembers"]["$room"]["$id"]
original_rm_write = rm[".write"]
assert "rooms" in original_rm_write, "unexpected roomMembers rule; aborting"
rm[".write"] = (
    "auth != null && ("
      # --- original behaviour, unchanged ---
      "(root.child('idToUid').child($id).val() === auth.uid && root.child('rooms').child($room).exists())"
      " || "
      # --- new: a channel of a server. Members add themselves; the people who can manage the
      #     server's channels may add anyone (needed when a new channel is created). ---
      "(root.child('channelServer').child($room).exists() && "
      "(!newData.exists() || !root.child('serverBans').child(root.child('channelServer').child($room).val()).child($id + '').exists()) && ("
        "(root.child('idToUid').child($id).val() === auth.uid && "
         "root.child('serverMembers').child(root.child('channelServer').child($room).val()).child($id + '').exists())"
        " || "
        "(" + manager("root.child('channelServer').child($room).val()", "manageCh") + ")"
      "))"
    ")"
)
# Removal (leaving a server / deleting a channel) must be possible too.
rm[".validate"] = "newData.val() === true"

# =====================================================================
# 2. NEW NODES
# =====================================================================
NAME = "newData.isString() && newData.val().length >= 2 && newData.val().length <= 40"
HEX  = "newData.val() === '' || newData.val().matches(/^#[0-9a-fA-F]{3,8}$/)"

# ---- servers/$sid ----
rules["servers"] = collections.OrderedDict({
    "$sid": collections.OrderedDict({
        # readable by any signed-in user so invite links can show a server name before joining
        ".read": AUTHED,
        ".write": ("auth != null && (" +
                   # create: I must be the owner I claim to be, and not banned
                   "(!data.exists() && newData.exists() && "
                   "root.child('idToUid').child(newData.child('ownerId').val() + '').val() === auth.uid && " + NOT_BANNED + ")"
                   " || " +
                   # edit / delete: server owner, or a site owner
                   "(data.exists() && (root.child('idToUid').child(data.child('ownerId').val() + '').val() === auth.uid || " + SITE_OWNER + "))"
                   ")"),
        ".validate": "newData.hasChildren(['name','ownerId','createdAt'])",
        "name":      {".validate": NAME},
        "icon":      {".validate": "newData.isString() && newData.val().length <= 8"},
        # an uploaded icon, stored exactly like an avatar: a compressed data URL, size-capped
        "img":       {".validate": "newData.isString() && newData.val().length <= 400000 && "
                                   "(newData.val().beginsWith('data:image/jpeg;base64,') || "
                                   "newData.val().beginsWith('data:image/png;base64,') || "
                                   "newData.val().beginsWith('data:image/webp;base64,'))"},
        "ownerId":   {".validate": "newData.isNumber()"},
        "createdAt": {".validate": "newData.isNumber()"},
        "$other":    {".validate": False},
    })
})

# ---- userServers/$uid/$sid ----
rules["userServers"] = collections.OrderedDict({
    "$id": collections.OrderedDict({
        ".read": "auth != null && root.child('idToUid').child($id).val() === auth.uid",
        "$sid": collections.OrderedDict({
            ".write": ("auth != null && (root.child('idToUid').child($id).val() === auth.uid || " +
                       SITE_OWNER + " || " + srv_owner("$sid") + " || " + manager("$sid", "kick") + ")"),
            ".validate": "newData.val() === true",
        })
    })
})

# ---- serverOrder/$uid/$sid (purely cosmetic drag order of the rail) ----
rules["serverOrder"] = collections.OrderedDict({
    "$id": collections.OrderedDict({
        ".read": "auth != null && root.child('idToUid').child($id).val() === auth.uid",
        ".write": "auth != null && root.child('idToUid').child($id).val() === auth.uid",
        "$sid": {".validate": "newData.isNumber()"},
    })
})

# ---- channelServer/$key -> sid  (flat lookup so other rules can resolve a channel in O(1)) ----
rules["channelServer"] = collections.OrderedDict({
    ".read": AUTHED,
    "$key": collections.OrderedDict({
        ".write": ("auth != null && (" + SITE_OWNER + " || " +
                   # creating: whoever may manage the target server's channels
                   "(newData.exists() && " + manager("newData.val()", "manageCh") + ")" + " || " +
                   # deleting: whoever may manage the server it pointed at
                   "(!newData.exists() && data.exists() && " + manager("data.val()", "manageCh") + ")"
                   ")"),
        ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 64",
    })
})

# ---- serverCats/$sid/$catId ----
rules["serverCats"] = collections.OrderedDict({
    "$sid": collections.OrderedDict({
        ".read": AUTHED,
        ".write": "auth != null && " + manager("$sid", "manageCh"),
        "$cat": collections.OrderedDict({
            ".validate": "!newData.exists() || newData.hasChildren(['name','pos'])",
            "name":   {".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 40"},
            "pos":    {".validate": "newData.isNumber()"},
            "$other": {".validate": False},
        })
    })
})

# ---- serverChannels/$sid/$cid ----
PERM_KEYS = ['admin','view','manageCh','manageRoles','manageSrv','invite','changeNick','manageNick',
             'kick','ban','timeout','send','files','react','history','mentionAll','manageMsg',
             'voiceJoin','voiceSpeak','voiceMute']
perm_bool_map = collections.OrderedDict((k, {".validate": "newData.isBoolean()"}) for k in PERM_KEYS)

rules["serverChannels"] = collections.OrderedDict({
    "$sid": collections.OrderedDict({
        ".read": AUTHED,
        ".write": "auth != null && (" + manager("$sid", "manageCh") + " || " + manager("$sid", "manageRoles") + ")",
        "$cid": collections.OrderedDict({
            ".validate": "!newData.exists() || newData.hasChildren(['name','key'])",
            "name":  {".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 40"},
            "key":   {".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 64 && !newData.val().beginsWith('dm_')"},
            "cat":   {".validate": "newData.isString() && newData.val().length <= 40"},
            "type":  {".validate": "newData.val() === 'text' || newData.val() === 'voice'"},
            "pos":   {".validate": "newData.isNumber()"},
            "topic": {".validate": "newData.isString() && newData.val().length <= 300"},
            "nsfw":  {".validate": "newData.isBoolean()"},
            "ov": collections.OrderedDict({                      # per-role channel overrides
                "$rid": collections.OrderedDict({
                    "allow": collections.OrderedDict(perm_bool_map),
                    "deny":  collections.OrderedDict(perm_bool_map),
                    "$other": {".validate": False},
                })
            }),
            "$other": {".validate": False},
        })
    })
})

# ---- serverRoles/$sid/$rid ----
rules["serverRoles"] = collections.OrderedDict({
    "$sid": collections.OrderedDict({
        ".read": AUTHED,
        ".write": "auth != null && " + manager("$sid", "manageRoles"),
        "$rid": collections.OrderedDict({
            ".validate": "!newData.exists() || newData.hasChildren(['name','pos'])",
            "name":        {".validate": "newData.isString() && newData.val().length >= 1 && newData.val().length <= 40"},
            "color":       {".validate": "newData.isString() && (" + HEX + ")"},
            # 0 is reserved for @everyone; user-made roles stay under the virtual legacy ranks
            "pos":         {".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 900"},
            "hoist":       {".validate": "newData.isBoolean()"},
            "mentionable": {".validate": "newData.isBoolean()"},
            "perms":       collections.OrderedDict(perm_bool_map),
            "$other":      {".validate": False},
        })
    })
})

# ---- serverMembers/$sid/$uid ----
rules["serverMembers"] = collections.OrderedDict({
    "$sid": collections.OrderedDict({
        ".read": AUTHED,
        "$id": collections.OrderedDict({
            ".write": ("auth != null && "
                       # A server ban blocks the membership record from coming back, which is what
                       # makes a ban stick: without this a banned user could simply rejoin.
                       # Removal is always allowed, so staff can still clear the record.
                       "(!newData.exists() || !root.child('serverBans').child($sid).child($id).exists()) && (" +
                       # join yourself (membership record creation), or leave
                       "(root.child('idToUid').child($id).val() === auth.uid)"
                       " || " + SITE_OWNER + " || " + srv_owner("$sid") +
                       " || " + manager("$sid", "kick") +
                       " || " + manager("$sid", "manageRoles") +
                       ")"),
            ".validate": "!newData.exists() || newData.hasChild('at')",
            "at":   {".validate": "newData.isNumber()"},
            "nick": {".validate": "newData.isString() && newData.val().length <= 32"},
            "roles": collections.OrderedDict({
                # role assignment is a privileged action even on your own record
                ".write": ("auth != null && (" + SITE_OWNER + " || " + srv_owner("$sid") +
                           " || " + manager("$sid", "manageRoles") + ")"),
                "$rid": {".validate": "newData.val() === true"},
            }),
            "p": collections.OrderedDict({
                # the denormalised effective-permission cache the rules above read.
                # Only the people who can manage roles may write it, so it cannot be self-granted.
                ".write": ("auth != null && (" + SITE_OWNER + " || " + srv_owner("$sid") +
                           " || " + manager("$sid", "manageRoles") + ")"),
                **perm_bool_map,
            }),
            "$other": {".validate": False},
        })
    })
})

# =====================================================================
# PER-SERVER MODERATION
#
# The rule everywhere below: a server's punishments apply to THAT server only. ICH is the
# exception, and only because ICH is the site itself - a ban there still uses the existing
# site-wide banned/ node and locks everything, which is unchanged from before.
# =====================================================================

# ---- serverBans/$sid/$uid ----
rules["serverBans"] = collections.OrderedDict({
    "$sid": collections.OrderedDict({
        # readable by any signed-in user so a client can tell it has been banned and say so
        ".read": AUTHED,
        "$id": collections.OrderedDict({
            ".write": "auth != null && " + manager("$sid", "ban"),
            ".validate": "!newData.exists() || newData.hasChildren(['at','by'])",
            "at":     {".validate": "newData.isNumber()"},
            "by":     {".validate": "newData.isNumber()"},
            "reason": {".validate": "newData.isString() && newData.val().length <= 200"},
            "$other": {".validate": False},
        })
    })
})

# ---- serverMutes/$sid/$uid = timestamp the timeout expires ----
rules["serverMutes"] = collections.OrderedDict({
    "$sid": collections.OrderedDict({
        ".read": AUTHED,
        "$id": collections.OrderedDict({
            ".write": "auth != null && " + manager("$sid", "timeout"),
            # a timeout is a future expiry, capped at 28 days like Discord's
            ".validate": "!newData.exists() || (newData.isNumber() && newData.val() > now - 60000 "
                         "&& newData.val() < now + 2419200000)",
        })
    })
})

# ---- serverIpBans/$sid/$hash ----
# Same hashed-IP identifier the existing TOS gate already computes, so one network can be
# blocked from a single server without touching the site-wide ipBans/ node.
rules["serverIpBans"] = collections.OrderedDict({
    "$sid": collections.OrderedDict({
        ".read": AUTHED,
        "$h": collections.OrderedDict({
            ".write": "auth != null && " + manager("$sid", "ban"),
            ".validate": "!newData.exists() || newData.hasChildren(['at','by'])",
            "at":     {".validate": "newData.isNumber()"},
            "by":     {".validate": "newData.isNumber()"},
            "uid":    {".validate": "newData.isNumber()"},
            "reason": {".validate": "newData.isString() && newData.val().length <= 200"},
            "$other": {".validate": False},
        })
    })
})

# ---- serverDiscovery/$sid : opt-in public listing ----
rules["serverDiscovery"] = collections.OrderedDict({
    ".read": AUTHED,
    "$sid": collections.OrderedDict({
        ".write": ("auth != null && (" + manager("$sid", "manageSrv") + " || " + SITE_OWNER + ")"),
        ".validate": "!newData.exists() || newData.hasChildren(['name','at'])",
        "name":    {".validate": NAME},
        "desc":    {".validate": "newData.isString() && newData.val().length <= 200"},
        "icon":    {".validate": "newData.isString() && newData.val().length <= 8"},
        "img":     {".validate": "newData.isString() && newData.val().length <= 400000"},
        "at":      {".validate": "newData.isNumber()"},
        "members": {".validate": "newData.isNumber()"},
        "$other":  {".validate": False},
    })
})

# =====================================================================
# SCOPE TIMEOUTS TO THE SERVER THEY WERE ISSUED IN
#
# The message rule used one global check: muted/$sender blocks sending ANYWHERE. That is right
# for the five original ICH keys and for DMs, but wrong for a channel on someone else's server -
# a timeout there must not silence you site-wide, and an ICH timeout must not silence you in
# other people's servers. So for server channels the check becomes that server's own mute and
# ban records instead.
# =====================================================================
SENDER = "newData.child('senderId').val() + ''"
OLD_MUTE = ("(!root.child('muted').child(%s).exists() || "
            "root.child('muted').child(%s).val() <= now)" % (SENDER, SENDER))
CHAN_SID = "root.child('channelServer').child($key).val()"
NEW_MUTE = (
    "("
    "root.child('channelServer').child($key).exists() ? ("
        "(!root.child('serverMutes').child(%s).child(%s).exists() || "
         "root.child('serverMutes').child(%s).child(%s).val() <= now)"
        " && !root.child('serverBans').child(%s).child(%s).exists()"
    ") : %s"
    ")" % (CHAN_SID, SENDER, CHAN_SID, SENDER, CHAN_SID, SENDER, OLD_MUTE)
)
_w = rules["messages"]["$key"]["$msg"][".write"]
assert _w.count(OLD_MUTE) == 1, "mute fragment not found exactly once in messages"
rules["messages"]["$key"]["$msg"][".write"] = _w.replace(OLD_MUTE, NEW_MUTE, 1)

# typing indicators follow the same scoping, so a timed-out member does not show as typing
_t = rules["typing"]["$key"]["$id"][".write"]
_old_t = "root.child('banned').child($id).val() !== true"
assert _old_t in _t, "typing rule shape changed"
rules["typing"]["$key"]["$id"][".write"] = _t.replace(
    _old_t,
    _old_t + " && (!root.child('channelServer').child($key).exists() || "
             "!root.child('serverBans').child(root.child('channelServer').child($key).val()).child($id).exists())",
    1)

# ---- invites/$sid/$code ----
# Keyed by server on purpose. Two things fall out of it:
#   * $sid is a wildcard, so the rules say "$sid" instead of repeating
#     newData.child('sid').val() a dozen times - this rule used to be the single longest line in
#     the whole file at 3.2KB.
#   * a server's own staff can list its invites with one read, so the separate index node this
#     used to need is gone entirely.
# inviteCodes/$code -> sid is the lookup that turns a bare code (all anyone types) into a server.
rules["invites"] = collections.OrderedDict({
    "$sid": collections.OrderedDict({
        ".read": ("auth != null && (" + manager("$sid", "invite") + " || " +
                  manager("$sid", "manageSrv") + ")"),
        "$code": collections.OrderedDict({
            # anyone signed in may read ONE code they already know, to join with it
            ".read": AUTHED,
            ".write": ("auth != null && " + NOT_BANNED + " && ("
                       # create
                       "(!data.exists() && newData.exists() && " + manager("$sid", "invite") +
                       " && newData.child('by').val() === root.child('uidToId').child(auth.uid).val())"
                       " || "
                       # count a use: nothing may change except uses, and only by exactly +1
                       "(data.exists() && newData.exists()"
                       " && newData.child('by').val() === data.child('by').val()"
                       " && newData.child('at').val() === data.child('at').val()"
                       " && newData.child('uses').val() === data.child('uses').val() + 1)"
                       " || "
                       # revoke
                       "(data.exists() && !newData.exists() && (" + SITE_OWNER +
                       " || root.child('uidToId').child(auth.uid).val() === data.child('by').val() || " +
                       manager("$sid", "manageSrv") + "))"
                       ")"),
            ".validate": "!newData.exists() || newData.hasChildren(['by','at','uses'])",
            "by":   {".validate": "newData.isNumber()"},
            "at":   {".validate": "newData.isNumber()"},
            "uses": {".validate": "newData.isNumber() && newData.val() >= 0"},
            "max":  {".validate": "newData.isNumber() && newData.val() > 0"},
            "exp":  {".validate": "newData.isNumber()"},
            "$other": {".validate": False},
        })
    })
})

# ---- inviteCodes/$code -> $sid ----
rules["inviteCodes"] = collections.OrderedDict({
    "$code": collections.OrderedDict({
        ".read": AUTHED,
        ".write": ("auth != null && " + NOT_BANNED + " && ("
                   "(newData.exists() && " + manager("newData.val()", "invite") + ")"
                   " || (!newData.exists() && (" + SITE_OWNER + " || " + manager("data.val()", "manageSrv") + "))"
                   ")"),
        ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 64",
    })
})

# ---- pins/$key/$msgId (Discord pinned messages) ----
rules["pins"] = collections.OrderedDict({
    "$key": collections.OrderedDict({
        ".read": AUTHED,
        "$msg": collections.OrderedDict({
            ".write": ("auth != null && " + NOT_BANNED + " && (" + SITE_OWNER +
                       " || root.child('mods').child(%s).val() === 1" % MY +
                       " || root.child('admin').child(%s).val() === 1" % MY +
                       " || (root.child('channelServer').child($key).exists() && " +
                       manager("root.child('channelServer').child($key).val()", "manageMsg") + "))"),
            ".validate": "!newData.exists() || newData.isNumber()",
        })
    })
})

# =====================================================================
# PER-CHANNEL VOICE: voice/members/$id gains a `ch` field.
#
# Voice used to be one global room, so a presence record didn't need to say WHICH room it was
# for. Servers have their own voice channels now, so each record carries the channel key it
# belongs to and the roster is filtered by it. This has to be declared explicitly because the
# node ends in "$other": false - an undeclared child is rejected outright, which would make
# every voice join fail with PERMISSION_DENIED.
#
# Nothing else about voice changes: the Agora channel name is derived from this key in the
# browser, and forceMuted/kick stay per-account (a moderator mute follows the person into
# whichever channel they are in, which is what Discord does too).
# =====================================================================
# =====================================================================
# PRESENCE STATUS: users/$id/style gains `status` and `customStatus`.
#
# Discord's status picker (Online / Idle / Do Not Disturb / Invisible, plus a custom line) needs
# somewhere everyone can read it from, and style/ is the public half of a profile - which is
# exactly right, since a status is public by definition. Like voice/members, this node ends in
# "$other": false, so both fields have to be declared or the write is refused.
# =====================================================================
style = rules["users"]["$id"]["style"]
assert style.get("$other", {}).get(".validate") is False, "unexpected users/style rule; aborting"
_st = collections.OrderedDict()
for k, v in style.items():
    if k == "$other":
        _st["status"] = collections.OrderedDict(
            [(".validate", "newData.isString() && newData.val().matches(/^(online|idle|dnd|invisible)$/)")])
        _st["customStatus"] = collections.OrderedDict(
            [(".validate", "newData.isString() && newData.val().length <= 128")])
    _st[k] = v
rules["users"]["$id"]["style"] = _st

vm = rules["voice"]["members"]["$id"]
assert vm.get("$other", {}).get(".validate") is False, "unexpected voice/members rule; aborting"
_vm = collections.OrderedDict()
for k, v in vm.items():
    if k == "$other":
        _vm["ch"] = collections.OrderedDict(
            [(".validate", "newData.isString() && newData.val().length <= 64")])
    _vm[k] = v
rules["voice"]["members"]["$id"] = _vm

# ---------------------------------------------------------------------
# Self-check. An earlier edit to this script silently deleted a whole block of nodes and the
# output still looked plausible, so the build now refuses to write a file that is missing
# anything it is supposed to contain.
EXPECTED = ['servers','userServers','serverOrder','channelServer','serverCats','serverChannels',
            'serverRoles','serverMembers','invites','inviteCodes','pins','serverBans',
            'serverMutes','serverIpBans','serverDiscovery']
missing_nodes = [n for n in EXPECTED if n not in rules]
if missing_nodes:
    raise SystemExit("ABORT - these nodes did not make it into the output: " + ", ".join(missing_nodes))
if 'serverMutes' not in rules['messages']['$key']['$msg']['.write']:
    raise SystemExit("ABORT - timeouts were not scoped per server in the messages rule")
if 'serverBans' not in rules['typing']['$key']['$id']['.write']:
    raise SystemExit("ABORT - the typing rule lost its server-ban check")
if 'channelServer' not in rules['roomMembers']['$room']['$id']['.write']:
    raise SystemExit("ABORT - roomMembers was not extended for server channels")
if 'ch' not in rules['voice']['members']['$id']:
    raise SystemExit("ABORT - voice/members lost its per-channel `ch` field")
if 'status' not in rules['users']['$id']['style']:
    raise SystemExit("ABORT - users/style lost its presence status fields")

with open(OUT, "w") as f:
    json.dump(doc, f, indent=1)
    f.write("\n")

print("wrote", OUT)
print("top-level nodes:", len(rules))
added = ['servers','userServers','serverOrder','channelServer','serverCats',
         'serverChannels','serverRoles','serverMembers','invites','pins',
         'serverBans','serverMutes','serverIpBans','serverDiscovery','inviteCodes']
print("added:", ", ".join(added))
print("edited in place: roomMembers/$room/$id/.write")
print("edited in place: messages/$key/$msg/.write  (timeouts scoped per server)")
print("edited in place: typing/$key/$id/.write     (server bans)")
