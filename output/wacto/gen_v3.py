"""Stage 3: BJP Nalam Thittam English flow, built from exported_chatbot (25).json.
Backend-answered options (no WACTO edge): My Registration, My Referral Link, My Members,
Be a Volunteer, Volunteer only, every scheme row, ✅ Done Selecting.
Usage: python -I gen_v3.py <export25.json> <out_raw.json>"""
import json, sys, uuid, copy
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

# ── EPIC ask (one node for everyone) ─────────────────────────────────────────
epic = by['Register: EPIC Ask (Schemes)']
epic['name'] = 'Register: EPIC Ask'
as_button_node(epic,
    "📋 *Register*\n\n1️⃣ Type your *EPIC (Voter ID)* number and send it — e.g. *TNA1234567*\n"
    "2️⃣ When you see *✅ Voter ID found*, tap *Continue ✅*\n\n"
    "👇 No voter ID card? Tap *I don't have EPIC*.",
    ["Continue ✅", "I don't have EPIC"])
d['nodes'] = [n for n in d['nodes'] if n['name'] != 'Register: EPIC Ask (Volunteer)']

name_ask = by['Ask: Full Name (No EPIC)']
as_button_node(name_ask,
    "📝 *Your Full Name*\n\nType your full name and send it — e.g. *Vijay Kumar*.\n\n"
    "Then tap *Continue ✅* to choose your district.",
    ["Continue ✅"])

# ── new: What next? ──────────────────────────────────────────────────────────
what_next = copy.deepcopy(name_ask)
what_next.update({"nodeId": U(), "name": "Register: What Next?", "keywords": [],
                  "canvasPosition": {"x": 8320, "y": 820}})
as_button_node(what_next,
    "📍 *Almost done!*\n\nWhat would you like to do?\n\n"
    "• *Pick Schemes* — apply for welfare schemes\n"
    "• *Volunteer only* — apply to volunteer for BJP TN\n"
    "• *Schemes + Volunteer* — both",
    ["Pick Schemes", "Volunteer only", "Schemes + Volunteer"])
d['nodes'].append(what_next)

# ── scheme pages: titles ≤24, honest body ────────────────────────────────────
scheme_pages = sorted([n for n in d['nodes'] if n['name'].startswith('Select Schemes')], key=lambda n: n['name'])
for i, n in enumerate(scheme_pages, 1):
    n['data']['body'] = (f"🎯 *Select Schemes* (Page {i} of {len(scheme_pages)})\n\n"
                         "Tap a scheme to add it — you'll get a ✅ for each one.\n"
                         "To add more, open this list again.\n"
                         "Tap *✅ Done Selecting* when you're finished.")
    for r in rows(n):
        if r['title'].startswith('More Schemes'):
            r['title'] = 'More Schemes →'

# ── support: drop the placeholder phone line, keep Ram's wording ─────────────
sup = by['Support']
as_button_node(sup, "\n".join(l for l in sup['data']['body'].split("\n") if 'XXXXX' not in l), ["Main Menu"])

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
edge(epic, 'Continue ✅', what_next)
edge(epic, "I don't have EPIC", name_ask)
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
            edge(n, r['title'], what_next)
edge(what_next, 'Pick Schemes', scheme_pages[0])
edge(what_next, 'Schemes + Volunteer', scheme_pages[0])
for a, b in zip(scheme_pages, scheme_pages[1:]):
    edge(a, 'More Schemes →', b)

# parentNodeId = first parent (canvas tree), as in the working EDMS export
first_parent = {}
for e in edges:
    first_parent.setdefault(e['toNodeId'], e['fromNodeId'])
for n in d['nodes']:
    n['parentNodeId'] = None if n['nodeId'] == 'root' else first_parent.get(n['nodeId'])

d['edges'] = edges
d['chatbot'] = {"name": "BJP Nalam Thittam v3 (English)"}
json.dump(d, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f"nodes {len(d['nodes'])}  edges {len(edges)}")
