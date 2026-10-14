# BJP Nalam Thittam — WACTO flow + backend audit (2026-10-09)

Inputs: `Downloads\exported_chatbot (25).json`, `BJP_Schemes/backend` (bjpWactoController, bjpWactoRoutes, whatsappWebhook, whatsappChatbot), live server (read-only).
Tools run: `inspect_flow.py`, `verify_flow.py`, id-clash scan over Downloads, scheme-name match against `constants/schemes.js`, live PM2 log grep.

## Findings — 3 root causes behind almost every defect

1. **The flow has 0 edges.** 57 nodes, 0 edges → 56 nodes unreachable. Only the root menu can ever send; every tap after it goes nowhere.
2. **The backend answers nothing.** `POST /api/whatsapp/bjp-wacto/events` only `console.log`s and returns 200. The BJP backend has no WACTO sender. The 5 REST endpoints (`/register /volunteer /profile /referral /members`) wait for structured POSTs that nothing sends: the flow has no API nodes and no variables. Both files are untracked in git. Live server: the controller is not deployed, and PM2 logs show 0 `[WACTO Event]` lines.
3. **Ids are burnt.** All 440 ids in (25) are live in WACTO (it is an export). `bjp_nalam_thittam_v2.json` reused all 440, which is why v2 was silent. Any rebuild must go through `reid_flow.py`.

Other defects:
- 3 list row titles over 24 chars (`More Schemes → (Page 2/4)` etc., 25 chars). Meta rejects the whole list, so scheme pages 1–3 would never arrive.
- Typed EPIC goes nowhere: the EPIC Ask node's only option is "I don't have EPIC". No step reads or checks a typed EPIC.
- Volunteer path is dead: in the v2 attempt, schemes and volunteers share one district/assembly picker, and all 234 assembly rows lead to Select Schemes. WACTO can't branch on how the user arrived, and no volunteer request is ever created.
- The root menu has two volunteer options ("Register as Volunteer" and "Be a Volunteer").
- No nodes for My Registration / My Referral Link / My Members / Be a Volunteer. v2 added placeholders that say "send Hi to restart", which are dead ends.
- 15 of 32 scheme titles in the flow don't match the 23 schemes in `constants/schemes.js` (PM-POSHAN Tracker, Ayushman 70+, NAPS, PM-YASASVI, NMMS, KCC, DAY-NRLM, Sukanya Samriddhi, PM Surya Ghar, PM-KUSUM, PMMSY, PM-FME, PM Mudra, PMEGP). The backend would record them as `not_found`. The live Scheme collection still needs checking.
- The Support node shows a placeholder number (+91 94444 XXXXX), promises a reply in 2 hours, and creates no ticket.
- ~~53 list nodes carry a leftover "Button 1" reply button.~~ Withdrawn: every working list node in EDMS (22)/(24)/v6 stores this placeholder. It is normal WACTO export shape.
- Security: the 5 bjp-wacto endpoints are open, unauthenticated POSTs. Anyone with the URL can create Users, SchemeApplications and volunteer requests for any phone number. `findSchemeByName` builds a regex from unescaped input. `/events` would log phone numbers and message text.
- Minor: `member_count` caps at 20. WhatsApp sign-ups never set `referredBy`, so no referral credit.
- `bjptn-backend` runs as a PM2 cluster with 4 workers, so chat state must be stored in Mongo. In-memory state would be lost between workers.

## Menu options the backend already answers

**None today.**

| Menu option | WACTO node in (25) | Backend replies today | Backend logic that exists (not wired) | Should be answered by |
|---|---|---|---|---|
| Register for Schemes | EPIC Ask | No | — | WACTO (EPIC Ask) |
| └ typed EPIC | none | No | none (`findVoterByEpic` not used) | Backend |
| └ "✅ Done Selecting" confirmation | none | No | `registerSchemes` | Backend |
| Register as Volunteer | EPIC Ask (Vol) | No | `registerVolunteer` | depends on option A/B |
| My Registration | none | No | `getProfile` | Backend (no WACTO node) |
| My Referral Link | none | No | `getReferral` | Backend (no WACTO node) |
| My Members | none | No | `getMembers` | Backend (no WACTO node) |
| Be a Volunteer (status) | none | No | nothing reads status | Backend (no WACTO node) |
| Support | Support | No | nothing | WACTO (fix the number) |

The separate Meta-native bot (`/api/whatsapp/webhook`, `whatsappChatbot.js`) only answers greetings and its own WhatsApp Flows. Any other list label gets the fallback text.

## Volunteer path — 2 options

**A. Separate volunteer picker in WACTO.** Clone the 5 district + 43 assembly nodes with fresh ids for the volunteer branch. Assembly rows on that branch have no WACTO edge. The backend sees the assembly tap with `mode=volunteer`, creates the BoothPresidentRequest and replies "Application submitted".
- Pros: anyone can volunteer without registering for a scheme first.
- Cons: +48 nodes and about 280 edges. The Tamil version doubles it again (~200 nodes). Two pickers to keep in sync.

**B. Volunteering handled only by the backend, for registered users (recommended).** Merge the two volunteer options into one "Be a Volunteer", with no WACTO node. The backend looks up the mobile number:
- not registered → "Register for Schemes first", with a button back to the menu
- no application → apply now, using the district and assembly already on file
- Pending, Approved or Rejected → show the status

Pros: 0 new nodes, removes the duplicate option, uses data already checked against the voter record, easy to do in Tamil. Cons: someone who only wants to volunteer must register for at least one scheme first. That is a product decision for Ram.

## Plan (no JSON until Ram approves)

0. **Decisions needed from Ram:** volunteer option A or B. Which number WACTO is on, and whether the Meta-native bot shares it. Which scheme list is final (32 in the flow, 23 in constants, live DB). The real support number. Tamil now or after English is live.
1. **Backend first** (the label-driven pattern from EDMS `wactoWebhookController.js`):
   - Add a WACTO sender with BJP env keys.
   - `/events` reads the tapped title or typed text.
   - Session per phone stored in Mongo.
   - `applySelection`: district, assembly, scheme, mode.
   - A typed EPIC triggers the lookup and replies with the voter details or "not found".
   - Wire in the backend-answered options from the table.
   - Reuse the existing helpers (`findOrCreateUser`, `applyForScheme`).
   - Scheme title→name map.
   - Lock the open endpoints, escape the regex, stop logging message text.
   - Commit.
2. **Offline replay harness** (fake DB + fake WACTO sender). Run it on the unpatched code first; it must reproduce "bot silent". Then the patched code must pass:
   - new user with EPIC, and without EPIC
   - volunteer
   - every returning-user option
   - fallback, and the case where the user taps Continue without typing anything
3. **Flow JSON**, starting from (25):
   - Add all edges.
   - EPIC Ask gets a "Continue ✅" button to Schemes p1.
   - Shorten "More Schemes →" to 24 chars or less.
   - No WACTO nodes for backend-answered options.
   - Run `reid_flow.py`, then `verify_flow.py` with the walks below.
4. **Deploy** in a quiet window:
   - Diff the live server against local, then back up.
   - Upload, run `node --check`, then `pm2 restart bjptn-backend`, then read the logs.
   - In WACTO: import as a NEW chatbot, disable the old one and v2, then delete them.
   - Point the WACTO webhook at `/events`.
5. **Live test** with a tap-by-tap script for Ram, then check the saved DB records for the test number.

## Risks
- **Handing control back to WACTO after typed text is unproven.** Test a 2-node mini-flow before building the full one.
- **Possible double replies** if a backend-answered option also gets a WACTO node, or if the user taps Continue before typing.
- **WACTO webhook config:** it is not yet known whether WACTO sends events to the BJP backend at all (0 events in the logs). It may need setting up in the WACTO dashboard first.
- **Two bots on one number:** if the Meta-native bot is on the same number, users get two replies.
- **Scheme name mismatch** means silently skipped applications.
- **Deploying to a live cluster with 4 workers,** shared with the tnbjp.org web app.

## Success criteria
- `verify_flow.py`: 0 errors, 0 unreachable nodes, all labels within limits. `reid_flow.py`: 0 id clashes.
- Walks that must pass:
  - `Register for Schemes|I don't have EPIC|Continue ✅|Chennai|More Assemblies →|Velachery|More Schemes →`
  - `Register for Schemes|I don't have EPIC|Continue ✅|More Districts →|More Districts →|More Districts →|More Districts →|Virudhunagar`
  - `Register for Schemes|Continue ✅`
  - `Support|Main Menu`
  - plus the volunteer walk for whichever option is chosen
- Replay: the unpatched code reproduces "silent"; the patched code passes every scenario.
- Live: each menu option gives exactly one correct reply. The test number has 1 User, N SchemeApplications (all schemes matched) and, for volunteering, 1 BoothPresidentRequest with status Pending. The volunteer request appears in the admin panel.
- No "works" claim until Ram's live test passes.
