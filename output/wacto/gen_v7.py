"""BJP Nalam Thittam English flow v7 = v6 + page-1 keyword "➕ Add more schemes" (the backend's
button after each pick). v6 = v5 + WACTO scheme list pages (WACTO rejects list
messages sent through its API: "Invalid Interactive type", 2026-10-09). Page 1 has node
keywords "Pick Schemes" / "Schemes + Volunteer" so it opens when the user taps the backend's
"What next?" button. Built from exported_chatbot (25).json.
Ram 2026-10-09: no Continue on the EPIC screen; "What next?" only after a verified EPIC.
WACTO sends: menu, EPIC choice, name ask, district + assembly pickers, support.
Backend sends (no WACTO edge): EPIC prompt ("I have EPIC"), "What next?" (after a valid
EPIC or an assembly tap), scheme list pages, Done, volunteer, My Registration/Referral/Members.
Usage: python -I gen_v5.py <export25.json> <out_raw.json>"""
import json, sys, uuid
sys.stdout.reconfigure(encoding='utf-8')
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding='utf-8'))
U = lambda: str(uuid.uuid4())
by = {n['name']: n for n in d['nodes']}

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

# ── scheme pages (WACTO lists): rows answered by the backend, titles ≤24 ────────
scheme_pages = sorted([n for n in d['nodes'] if n['name'].startswith('Select Schemes')], key=lambda n: n['name'])
for i, n in enumerate(scheme_pages, 1):
    n['data']['body'] = (f"🎯 *Select Schemes* (Page {i} of {len(scheme_pages)})\n\n"
                         "Tap a scheme to add it — you'll get a ✅ for each one.\n"
                         "To add more, open this list again.\n"
                         "Tap *✅ Done Selecting* when you're finished.")
    for r in rows(n):
        if r['title'].startswith('More Schemes'):
            r['title'] = 'More Schemes →'
        elif r['title'] == 'Ayushman Bharat':
            r['title'] = 'Ayushman Bharat / CMCHIS'   # exact live Scheme name (24 chars)
scheme_pages[0]['keywords'] = ['Pick Schemes', 'Schemes + Volunteer', '➕ Add more schemes']  # backend button titles

# ── remove the node the backend now replaces ─────────────────────────────────
gone = {'Register: EPIC Ask (Volunteer)'}
d['nodes'] = [n for n in d['nodes'] if n['name'] not in gone]

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
        # assembly rows → backend sends "What next?"
for a, b in zip(scheme_pages, scheme_pages[1:]):
    edge(a, 'More Schemes →', b)
# scheme rows + ✅ Done Selecting → backend; page 1 opens by keyword (no incoming edge)

first_parent = {}
for e in edges:
    first_parent.setdefault(e['toNodeId'], e['fromNodeId'])
for n in d['nodes']:
    n['parentNodeId'] = None if n['nodeId'] == 'root' else first_parent.get(n['nodeId'])

d['edges'] = edges
d['chatbot'] = {"name": "BJP Nalam Thittam v7 (English)"}
json.dump(d, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f"nodes {len(d['nodes'])}  edges {len(edges)}")
