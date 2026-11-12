#!/usr/bin/env python3
"""
scripts/add_rules_dm_requests.py — v54.5: message requests.

    python3 scripts/add_rules_dm_requests.py firebase-rules.json firebase-rules.json

WHAT THIS IS FOR
  You can now message somebody you are not friends with. The first message raises a REQUEST
  that they accept or decline, and only an accepted request (or being friends already) opens
  the conversation properly. Declining ignores that person: the request does not come back.

ONE NEW NODE, AND ONLY ONE
  dmRequests/$to/$from = { at, msg?, ignored? }

  Everything else this feature needs already exists and is deliberately left alone:

    * messages/dm_a_b is gated on dmMembers/dm_a_b/$me, and dmMembers already lets ANY signed-in
      account write its OWN entry for a key containing its id - friendship was never a rules
      requirement, only a client-side one. So accepting a request is just the recipient writing
      the dmMembers entry they were always allowed to write. No message rule changes.
    * the recipient reads the conversation only AFTER accepting, which is what makes the preview
      below worth carrying: `msg` is a short copy of the first message, so the request can show
      what it is about without opening the whole conversation.

WHO CAN WRITE WHAT
  $from (the sender)   may CREATE their own request, and only while
                         - they are not blocked in either direction, and
                         - the recipient has not already ignored them.
                       That last clause is the teeth in "decline ignores them": once the
                       `ignored` marker is set, the rules stop the sender rewriting the row,
                       so a declined person cannot re-raise the request by sending again.
  $to   (the recipient) may write anything here, including deleting the row (accept) and
                       replacing it with an ignored one (decline).
  Nobody else can read it. Not mods, not site owners - a message request is private to the
  person who received it, the same way notes/$me already is.

WHAT THIS DOES NOT ENFORCE, AND WHY
  Settings -> Privacy -> "Who can DM me" is applied by the RECIPIENT's client, not here. Their
  setting lives in userPrivate, which the sender cannot read, so a rule could not consult it
  without making every account's privacy settings public - a worse trade than the one it fixes.
  The same reasoning is written up next to the activity switch in js/social/profile-data.js.
  A request from somebody whose setting excludes them is simply never shown, and never
  notified; the row is tidied by the recipient's own client.
"""
import json, sys, collections

SRC, OUT = sys.argv[1], sys.argv[2]
D = collections.OrderedDict

with open(SRC, encoding='utf-8') as f:
    doc = json.load(f, object_pairs_hook=D)
rules = doc["rules"]

IS_FROM = "root.child('idToUid').child($from).val() === auth.uid"
IS_TO   = "root.child('idToUid').child($to).val() === auth.uid"
NOT_BLOCKED = ("!root.child('blocked').child($to).child($from).exists() && "
               "!root.child('blocked').child($from).child($to).exists()")
NOT_IGNORED = "!root.child('dmRequests').child($to).child($from).child('ignored').exists()"

if "dmRequests" in rules:
    print("dmRequests is already in the rules - left alone")
    sys.exit(0)

node = D([
    ("$to", D([
        (".read", "auth != null && " + IS_TO),
        ("$from", D([
            # The sender may only ever write a row that is not already ignored, and never
            # somebody else's. The recipient may write anything, including removing it.
            (".write", "auth != null && (("
                       + IS_FROM + " && $from !== $to && " + NOT_BLOCKED + " && " + NOT_IGNORED
                       + ") || " + IS_TO + ")"),
            # Deletes skip .validate, so this only ever describes a row that exists.
            (".validate", "newData.hasChild('at') && $from !== $to && "
                          "root.child('idToUid').child($to).exists()"),
            ("at", D([(".validate", "newData.isNumber()")])),
            # A short copy of the first message, so the request can be shown with its context.
            ("msg", D([(".validate", "newData.isString() && newData.val().length <= 200")])),
            # Written by the recipient when they decline. Only ever true; removing the row
            # entirely is how an accept clears it.
            ("ignored", D([(".validate", "newData.isBoolean() && newData.val() === true")])),
            ("$other", D([(".validate", False)])),
        ])),
    ])),
])

# Insert next to friendRequests so the file reads in a sensible order.
items, placed = [], False
for k, v in rules.items():
    items.append((k, v))
    if k == "friendRequests":
        items.append(("dmRequests", node))
        placed = True
if not placed:
    items.append(("dmRequests", node))

doc["rules"] = D(items)

with open(OUT, "w", encoding='utf-8') as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)
    f.write("\n")

print("wrote %s" % OUT)
print("  dmRequests/$to/$from added: readable by $to only; $from may create unless blocked or ignored")
print("")
print("Additive: no existing node is touched, so nothing that works today stops working.")
print("Run the attack suite and compat-diff next:  npm test")
