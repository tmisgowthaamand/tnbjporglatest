"""BJP Nalam Thittam English flow v8b = v8 + WACTO links for the backend's buttons.
Learnt from the v8 export (exported_chatbot (28).json): WACTO routes a tap by matching its
text against EDGE keywords — node `keywords` (except root) are only derived from edges, so a
node with no incoming edge can never be opened. v6 only "worked" because the (inactive, later
deleted) v4 chatbot still had a "Pick Schemes" edge — WACTO matches edges account-wide.
So the WACTO node "Register: What Next?" (also sent after an assembly tap — assembly rows
need an edge of their own, or a same-name district edge would answer them) carries the edges
"Pick Schemes" → page 1 and "Schemes + Volunteer" → a copy of page 1.

v8 notes: (Ram 2026-10-09: keep the scheme picking inside the
WACTO flow; the backend only checks the EPIC, remembers picks and saves on Done).

WACTO sends: menu, EPIC choice, name ask, district + assembly pickers, support, the scheme
list pages (9 schemes + "More Schemes →" each), the "✅ Scheme added!" message after every
pick, and "Add more schemes" (→ a COPY of page 1).
Backend sends (no WACTO edge): EPIC prompt, "What next?" buttons, Done, volunteer,
My Registration / Referral / Members / Be a Volunteer.

Page 1 opens by node keyword when the user taps the backend's "Pick Schemes" /
"Schemes + Volunteer" button (proven live on v6). It must have NO incoming edge: WACTO
rewrites a node's keywords on import to the keywords of its incoming edges (seen in the
v7 export), so "Add more schemes" goes to a copy of page 1 instead.
Usage: python -I gen_v8.py <export25.json> <out_raw.json>"""
import json, sys, uuid, copy
sys.stdout.reconfigure(encoding='utf-8')
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding='utf-8'))
U = lambda: str(uuid.uuid4())
by = {n['name']: n for n in d['nodes']}
SCHEMES_PER_PAGE = 9   # + "More Schemes →" = 10 rows (WhatsApp max)
MORE = 'More Schemes →'
ADD_MORE = 'Add more schemes'
DONE = '✅ Done Selecting'

def btn(title):  # reply button, shape from exported_chatbot (22).json
    return {"type": "reply", "reply": {"id": U(), "title": title, "payload": ""}}

def as_button_node(n, body, titles):
    n['data']['body'] = body
    n['data']['interactiveType'] = 'button'
    n['data']['action'] = {"buttons": [btn(t) for t in titles], "sections": [],
                           "dynamicRows": {"enabled": False}, "button": ""}

def rows(n):
    return [r for s in n['data']['action']['sections'] for r in s['rows']]

# ── root menu ────────────────────────────────────────────────────────────────
root = by['Root Node']
root['data']['action']['sections'] = [{"title": "🪷 BJP Nalam Thittam", "rows": [
    {"id": U(), "title": "Register",         "description": "Schemes, volunteering, or both"},
    {"id": U(), "title": "My Registration",  "description": "View your registration & schemes"},
    {"id": U(), "title": "My Referral Link", "description": "Share and invite members"},
    {"id": U(), "title": "My Members",       "description": "Members you referred"},
    {"id": U(), "title": "Be a Volunteer",   "description": "Apply or check volunteer status"},
    {"id": U(), "title": "Support",          "description": "Get help from our team"},
]}]

# ── EPIC choice (WACTO); the EPIC prompt itself comes from the backend ────────
epic = by['Register: EPIC Ask (Schemes)']
epic['name'] = 'Register: EPIC Choice'
as_button_node(epic, "📋 *Register*\n\nDo you have your *Voter ID card (EPIC number)*?",
               ["I have EPIC", "I don't have EPIC"])

name_ask = by['Ask: Full Name (No EPIC)']
as_button_node(name_ask,
    "📝 *Your Full Name*\n\nType your full name and send it — e.g. *Vijay Kumar*.\n\n"
    "Then tap *Continue ✅* to choose your district.",
    ["Continue ✅"])

# ── support: drop the placeholder phone line ─────────────────────────────────
sup = by['Support']
as_button_node(sup, "\n".join(l for l in sup['data']['body'].split("\n") if 'XXXXX' not in l), ["Main Menu"])

# ── scheme pages: same 32 schemes as (25), re-paged 9 per page + More ────────
old_pages = sorted([n for n in d['nodes'] if n['name'].startswith('Select Schemes')], key=lambda n: n['name'])
scheme_rows = [dict(r) for n in old_pages for r in rows(n)
               if not r['title'].startswith('More Schemes') and 'Done Selecting' not in r['title']]
for r in scheme_rows:
    if r['title'] == 'Ayushman Bharat':
        r['title'] = 'Ayushman Bharat / CMCHIS'   # exact live Scheme name (24 chars)
chunks = [scheme_rows[i:i + SCHEMES_PER_PAGE] for i in range(0, len(scheme_rows), SCHEMES_PER_PAGE)]
assert len(chunks) == len(old_pages) == 4, (len(chunks), len(old_pages))
for i, (n, chunk) in enumerate(zip(old_pages, chunks), 1):
    n['data']['body'] = (f"🎯 *Select Schemes* (Page {i} of {len(chunks)})\n\n"
                         "Tap a scheme to add it — you can add more after each one."
                         + ("\nTap *More Schemes →* to see more." if i < len(chunks) else ""))
    page_rows = [{"id": U(), "title": r['title'], "description": r.get('description', '')} for r in chunk]
    if i < len(chunks):
        page_rows.append({"id": U(), "title": MORE, "description": f"Page {i + 1} of {len(chunks)}"})
    n['data']['action']['sections'] = [{"title": f"Schemes — Page {i}", "rows": page_rows}]
    n['keywords'] = []
scheme_pages = old_pages
scheme_pages[0]['keywords'] = []   # opened by the helper's "Pick Schemes" edge

def page1_copy(name, dy):
    c = copy.deepcopy(scheme_pages[0])
    c.update({"nodeId": U(), "name": name, "keywords": [],
              "canvasPosition": {"x": scheme_pages[0]['canvasPosition']['x'], "y": scheme_pages[0]['canvasPosition']['y'] + dy}})
    for r in rows(c):
        r['id'] = U()
    for b in c['data']['action'].get('buttons', []):   # WACTO's list placeholder "Button 1"
        b['reply']['id'] = U()
    d['nodes'].append(c)
    return c

# one page-1 node per opening title (a node keeps only ONE keyword: its last incoming edge)
page1_both = page1_copy("Select Schemes — Page 1/4 (both)", 800)
helper = copy.deepcopy(name_ask)
helper.update({"nodeId": U(), "name": "Register: What Next?", "keywords": [],
               "canvasPosition": {"x": scheme_pages[0]['canvasPosition']['x'] - 520, "y": scheme_pages[0]['canvasPosition']['y']}})
# Sent by WACTO after an assembly tap (no-EPIC path). On the EPIC path the backend sends the same
# three buttons after a verified EPIC; their taps match these edges too.
as_button_node(helper, "📍 *Almost done!*\n\nWhat would you like to do?\n\n"
               "• *Pick Schemes* — apply for welfare schemes\n"
               "• *Volunteer only* — apply to volunteer for BJP TN\n"
               "• *Schemes + Volunteer* — both",
               ['Pick Schemes', 'Volunteer only', 'Schemes + Volunteer'])
d['nodes'].append(helper)

page1_again = copy.deepcopy(scheme_pages[0])
page1_again.update({"nodeId": U(), "name": "Select Schemes — Page 1/4 (again)", "keywords": [],
                    "canvasPosition": {"x": scheme_pages[0]['canvasPosition']['x'],
                                       "y": scheme_pages[0]['canvasPosition']['y'] + 400}})
for r in rows(page1_again):
    r['id'] = U()
for b in page1_again['data']['action'].get('buttons', []):   # WACTO's list placeholder "Button 1"
    b['reply']['id'] = U()
d['nodes'].append(page1_again)

scheme_added = copy.deepcopy(name_ask)
scheme_added.update({"nodeId": U(), "name": "Scheme Added", "keywords": [],
                     "canvasPosition": {"x": 8840, "y": 820}})
as_button_node(scheme_added,
    "✅ *Scheme added!*\n\nAdd more schemes, or tap *✅ Done Selecting* to finish.",
    [ADD_MORE, DONE])
d['nodes'].append(scheme_added)

# ── remove the node the backend replaces ─────────────────────────────────────
d['nodes'] = [n for n in d['nodes'] if n['name'] != 'Register: EPIC Ask (Volunteer)']

# ── edges ────────────────────────────────────────────────────────────────────
N = {n['name']: n for n in d['nodes']}
edges = []
def edge(frm, title, to):
    opts = {r['title'] for r in rows(frm)} | {b['reply']['title'] for b in frm['data']['action'].get('buttons', [])}
    assert title in opts, (frm['name'], title)
    edges.append({"fromNodeId": frm['nodeId'], "toNodeId": to['nodeId'], "keywords": [title], "intentName": title, "delay": 0})

edge(root, 'Register', epic)
edge(root, 'Support', sup)
edge(sup, 'Main Menu', root)
edge(epic, "I don't have EPIC", name_ask)          # "I have EPIC" → backend
edge(name_ask, 'Continue ✅', N['Select District — Page 1/5'])
for k in range(1, 6):
    page = N[f'Select District — Page {k}/5']
    for r in rows(page):
        if r['title'].startswith('More Districts'):
            edge(page, r['title'], N[f'Select District — Page {k + 1}/5'])
        else:
            edge(page, r['title'], N[f"Assembly: {r['title']} p1"])
for n in [n for n in d['nodes'] if n['name'].startswith('Assembly: ')]:
    dist, p = n['name'][len('Assembly: '):].rsplit(' p', 1)
    for r in rows(n):
        if r['title'].startswith('More Assemblies'):
            edge(n, r['title'], N[f'Assembly: {dist} p{int(p) + 1}'])
        else:
            edge(n, r['title'], helper)   # WACTO "What next?"; the backend records the assembly

for i, page in enumerate([*scheme_pages, page1_again, page1_both]):
    nxt = scheme_pages[1] if page in (page1_again, page1_both) else (scheme_pages[i + 1] if i + 1 < len(scheme_pages) else None)
    for r in rows(page):
        if r['title'] == MORE:
            edge(page, MORE, nxt)
        else:
            edge(page, r['title'], scheme_added)       # backend silently records the pick
edge(scheme_added, ADD_MORE, page1_again)
edge(helper, 'Pick Schemes', scheme_pages[0])
edge(helper, 'Schemes + Volunteer', page1_both)
# helper 'Volunteer only' → backend
# "✅ Done Selecting" → backend saves everything

first_parent = {}
for e in edges:
    first_parent.setdefault(e['toNodeId'], e['fromNodeId'])
for n in d['nodes']:
    n['parentNodeId'] = None if n['nodeId'] == 'root' else first_parent.get(n['nodeId'])

d['edges'] = edges
d['chatbot'] = {"name": "BJP Nalam Thittam v8b (English)"}
json.dump(d, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f"nodes {len(d['nodes'])}  edges {len(edges)}  scheme rows {len(scheme_rows)}  pages {[len(c) for c in chunks]}")
