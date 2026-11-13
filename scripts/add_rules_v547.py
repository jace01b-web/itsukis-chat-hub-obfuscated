#!/usr/bin/env python3
"""
scripts/add_rules_v547.py - the v54.7 rules changes.

    python3 scripts/add_rules_v547.py firebase-rules.json firebase-rules.json

There are three. Two are additions of restrictive rules for new nodes. The third grants site
owners - and only site owners - the ability to LIST two existing collections whose children
they can already read one by one; its full justification is below, because "I loosened a rule
to make my feature work" is exactly the thing not to do quietly.

  1. customroleLog/            NEW
       ".read"  : site owners only
       ".write" : false, for every client without exception

     The grant history behind the global custom-role panel. It is written ONLY by
     api/customrole.js through the Admin SDK, which bypasses rules - exactly as
     customroles/ itself already works. Setting .write:false here is not belt-and-braces, it
     is the point: a history that the browser could append to would be worth nothing as a
     record of who did what, and one it could delete would be worth less than nothing.

     .read is owners-only rather than world-readable because, unlike customroles/, this node
     is a log of administrative activity - who was given what and when. Nobody else needs it.

  2. customroles/$role/expires/   NEW, under the existing customroles node

     customroles/ is already ".read": true / ".write": false, and the new child inherits both.
     No rule is added for it at all - it is listed here so the reason is on the record:
     a timed grant stores its expiry at customroles/<role>/expires/<id>, and it has to be
     world-readable for the same reason members/ is (every client decides whether to draw the
     role) and client-unwritable for the same reason too. The inherited rules are already
     correct, so touching them would only create a way to get them wrong.

  3. servers/.read  and  serverMembers/.read     site owners only

     The owner control center has to answer "how many servers are there", "which ones are
     public", "who owns this one" and "search every server" - all of which need the LIST of
     servers. No rule permitted that, because both collections only ever had per-child rules.

     Read what those per-child rules already say:

         servers/$sid/.read        auth != null && uidToId/<me> exists
         serverMembers/$sid/.read  auth != null && uidToId/<me> exists

     Every signed-in account can already read any individual server record and any individual
     server's member list. So this addition hands a site owner NO INFORMATION THEY COULD NOT
     ALREADY FETCH - it grants exactly one new capability, enumerating the keys, and it grants
     it to the one role the rules already test by admin-readable nodes (owners/, secretowner/).
     An ordinary member gains nothing: for them these collections stay unreadable as a whole,
     precisely as before.

     That is the narrowest change that makes the dashboard show real data. The alternative was
     another Admin-SDK endpoint, which would have been more private - but the site owner can
     already read every one of these records individually, so there was no privacy left to
     protect, and it would have put the dashboard behind a deployment step for no gain.

     The cost is real and worth stating: a site owner opening the dashboard downloads every
     server record and every membership map. js/discord/owner-center.js therefore reads both
     ONCE, with get() rather than a listener, and only when the panel is actually opened.

  4. serverDiscovery/$sid/cat  and  .../tags     NEW child validators

     The Discover listing record has "$other": {".validate": false}, which means any field it
     does not explicitly name is REJECTED - a good default, and the reason a category could not
     simply be written. Two validators are added:

         cat   a single category, string, <= 24 characters
         tags  a short comma-separated list, string, <= 100 characters

     No write rule changes: both inherit serverDiscovery/$sid/.write, which is already limited
     to that server's own staff and site owners. A member of a server still cannot touch its
     listing, and nobody can touch another server's.

WHAT THIS SCRIPT DELIBERATELY DOES NOT DO
  It does not add a rule letting a client write customroles/. The owner-facing panel added in
  v54.7 goes through api/customrole.js, which verifies the caller's ID token and checks
  owners//secretowner/ with an admin read. "Let the owner's browser write it" was the cheap
  alternative and would have meant trusting a client's claim about who it is.

RUN THE SUITES AFTERWARDS
      npm test
"""
import json, sys, collections

if len(sys.argv) != 3:
    sys.exit("usage: add_rules_v547.py <in.json> <out.json>")

SRC, OUT = sys.argv[1], sys.argv[2]
D = collections.OrderedDict

with open(SRC, encoding='utf-8') as f:
    doc = json.load(f, object_pairs_hook=D)
rules = doc["rules"]

MY = "root.child('uidToId').child(auth.uid).val() + ''"
SITE_OWNER = ("(root.child('owners').child(%s).val() === 1 || "
              "root.child('secretowner').child(%s).val() === 1)" % (MY, MY))

report, skipped = [], []

# ------------------------------------------------------------------ 1. customroleLog
if "customroleLog" in rules:
    skipped.append("customroleLog (already present - left exactly as it is)")
else:
    rules["customroleLog"] = D([
        (".read", "auth != null && " + SITE_OWNER),
        (".write", False),
        # Shape validation still earns its place even with .write:false. Rules are published
        # independently of this code, and if a future change ever opens this node up, the
        # validators are already here rather than being remembered at the time.
        ("$eid", D([
            (".validate",
             "newData.hasChildren(['at','act','role']) && "
             "newData.child('at').isNumber() && "
             "newData.child('act').isString() && newData.child('act').val().length <= 16 && "
             "newData.child('role').isString() && newData.child('role').val().length <= 40"),
            ("by", D([(".validate", "newData.isNumber()")])),
            ("target", D([(".validate", "newData.isNumber()")])),
            ("until", D([(".validate", "newData.isNumber()")])),
            ("$other", D([(".validate", False)])),
        ])),
    ])
    report.append("customroleLog: readable by site owners, writable by no client "
                  "(api/customrole.js writes it with the Admin SDK)")

# --------------------------------------------- 2. customroles: confirm, do not change
# ------------------------------------- 3. let site owners LIST servers and memberships
for node in ("servers", "serverMembers"):
    n = rules.get(node)
    if n is None:
        skipped.append("%s (not in the rules)" % node)
        continue
    cur = n.get(".read")
    if cur is not None:
        skipped.append("%s/.read is already set (%r) - LEFT ALONE" % (node, str(cur)[:60]))
        continue
    # Ordered so .read sits with the other node-level keys rather than after the $wildcards.
    rebuilt = D()
    rebuilt[".read"] = "auth != null && " + SITE_OWNER
    for k, v in n.items():
        rebuilt[k] = v
    rules[node] = rebuilt
    report.append("%s/.read: site owners may list it (each child was already readable by any "
                  "signed-in account, so this adds enumeration and no new content)" % node)

# ------------------------------------ 4. serverDiscovery category + tags validators
disc = rules.get("serverDiscovery", {}).get("$sid")
if disc is None:
    skipped.append("serverDiscovery/$sid (not in the rules)")
else:
    for field, maxlen in (("cat", 24), ("tags", 100)):
        if field in disc:
            skipped.append("serverDiscovery/$sid/%s already present - left alone" % field)
            continue
        # Insert before $other so the catch-all stays last, which is where it has to be.
        rebuilt = D()
        for k, v in disc.items():
            if k == "$other":
                rebuilt[field] = D([(".validate",
                    "newData.isString() && newData.val().length <= %d" % maxlen)])
            rebuilt[k] = v
        if field not in rebuilt:      # no $other at all; just append
            rebuilt[field] = D([(".validate",
                "newData.isString() && newData.val().length <= %d" % maxlen)])
        disc = rebuilt
        rules["serverDiscovery"]["$sid"] = disc
        report.append("serverDiscovery/$sid/%s: string up to %d chars, writable only by whoever "
                      "could already write the listing" % (field, maxlen))

cr = rules.get("customroles")
if cr is None:
    skipped.append("customroles (NOT IN THE RULES - the custom-role panel will not work until "
                   "it is added as {\".read\": true, \".write\": false})")
else:
    r, w = cr.get(".read"), cr.get(".write")
    if w is not False:
        skipped.append("customroles/.write is %r, expected false - LEFT ALONE, but the global "
                       "custom-role system assumes no client can write this node" % (w,))
    else:
        report.append("customroles/.write is false, as it must be - expires/ inherits it, so "
                      "timed grants are server-written only (no change made)")
    if r is None:
        skipped.append("customroles/.read is unset - clients cannot read roles at all")

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
