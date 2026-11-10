#!/usr/bin/env python3
"""
Refreshes the two JSON blocks inside rules-copy.html from the rules on disk.

    python3 scripts/build_rules_copy.py

rules-copy.html is the one-tap "copy the rules" page used to publish from a phone, where
selecting 100 KB of text by hand is what produces the console's "Unexpected EOF" error. It
embeds the rules twice:

    <script type="application/json" id="rules-min">   firebase-rules.min.json
    <script type="application/json" id="rules-full">  firebase-rules.json

Whenever the rules change, that page has to change with them - otherwise it quietly publishes an
OLD ruleset, which is a worse failure than it being out of date visibly, because everything looks
like it worked.
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
PAGE = os.path.join(ROOT, "rules-copy.html")

with open(PAGE, encoding="utf-8") as f:
    html = f.read()

with open(os.path.join(ROOT, "firebase-rules.json"), encoding="utf-8") as f:
    full_doc = json.load(f)
with open(os.path.join(ROOT, "firebase-rules.min.json"), encoding="utf-8") as f:
    min_doc = json.load(f)

if full_doc != min_doc:
    raise SystemExit("ABORT - firebase-rules.json and firebase-rules.min.json are not the same "
                     "rules. Regenerate the minified copy first.")

full_txt = json.dumps(full_doc, indent=1) + "\n"
min_txt = json.dumps(min_doc, separators=(",", ":"))

# A JSON payload can never contain "</script", so a plain non-greedy match is safe here.
def swap(doc, block_id, payload):
    pat = re.compile(
        r'(<script type="application/json" id="%s">)(.*?)(</script>)' % re.escape(block_id),
        re.S)
    if not pat.search(doc):
        raise SystemExit("ABORT - could not find the %s block in rules-copy.html" % block_id)
    return pat.sub(lambda m: m.group(1) + payload + m.group(3), doc, count=1)

html = swap(html, "rules-min", min_txt)
html = swap(html, "rules-full", full_txt)

with open(PAGE, "w", encoding="utf-8") as f:
    f.write(html)

# Read it back and prove both blocks parse to exactly the rules on disk, so a bad escape or a
# truncated write cannot ship looking fine.
with open(PAGE, encoding="utf-8") as f:
    check = f.read()
for block_id in ("rules-min", "rules-full"):
    m = re.search(r'<script type="application/json" id="%s">(.*?)</script>' % block_id, check, re.S)
    if not m:
        raise SystemExit("ABORT - %s block vanished on write" % block_id)
    if json.loads(m.group(1)) != full_doc:
        raise SystemExit("ABORT - %s block does not match the rules on disk" % block_id)

print("updated rules-copy.html")
print("  rules-min :", len(min_txt), "bytes")
print("  rules-full:", len(full_txt), "bytes")
print("  top-level nodes:", len(full_doc["rules"]))
