# Decisions

## 2026-10-05 — Footer: Terms & Conditions, Privacy Policy, Contact Us, copyright

FEATURE: Frontend — footer "Terms & Conditions · Privacy Policy · Contact Us" + "© 2026 Central Government Schemes. All rights reserved." on the member site (phones: under the Start banner; desktop ≥1024px: bottom of the left menu panel; also in the logged-in mobile side menu). Brand name and Terms/Privacy text supplied by Ram, used verbatim, English only. Contact: admin@tnbjp.org, +91 93601 92042, No: 5/79, Srinivasa Perumal Koil Street, Sadhanandapuram, Irandam Kattalai, Chennai - 600128 ("Streer" typo corrected; "Sadhanadapuram" → "Sadhanandapuram" per Ram, deployed 2026-10-05).
- Pages are static HTML (`frontend/public/{terms,privacy,contact}/index.html` + `public/legal.css`), not React routes, so Meta/Google crawlers can read them without JS. nginx serves `/terms/` from the folder; `/terms` → 301 → `/terms/`. Links open in a new tab so an in-progress registration isn't lost.
- `vite.config.js` gained a small dev/preview middleware mapping `/terms|privacy|contact[/]` to the folder's index.html (Vite otherwise falls back to the SPA — caught by Ram in local testing).
- Sitemap: added the 3 URLs.
- Deployed 2026-10-05 13:18 UTC: assets + pages uploaded first (md5-verified), `index.html` swapped last. Bundle `index-D6iWPepX-v2.js` (2,234,692 bytes). Verified live through Cloudflare: all 3 pages 200 with correct titles, footer visible, click-through works, 0 console errors, 0 5xx, API health OK.
- Rollback: `cd /var/www/bjptn/dist && cp index.html.pre-legal index.html && cp sitemap.xml.pre-legal sitemap.xml` (the static pages can stay; nothing links to them after rollback).

---

## 2026-09-24 — PERF: dashboard-stats cache fix (3 bugs fixed in one deploy)

**Root cause 1 — warmStatsCache payload mismatch (pre-existing, introduced in TASK-27):**
`warmStatsCache` built a payload under a `stats` key (`{ success: true, stats: { ... } }`) while `getDashboardStats` returns a flat structure with an `overview` key (`{ success: true, overview: { pendingVolunteers, totalVolunteers, totalIncomplete, ... }, districtStats: [...], ... }`). On first page load after any server restart, the browser received the warm (wrong) payload, `statsData.overview` was undefined, and the Action Required cards (TASK-27) never rendered. Admins had to click "Refresh Data" to force a `?live=1` bypass.

**Fix 1:** Rewrote `warmStatsCache` to build the exact same payload structure as `getDashboardStats`, including `pendingVolunteers` / `totalVolunteers` / `totalIncomplete` counts, `districtStats` and `assemblyStats` with voter roll counts, and `overview` at the top level.

**Root cause 2 — cache TTL too short:**
`STATS_TTL_MS = 5 * 60 * 1000` (5 min) meant each of the 4 PM2 cluster workers re-ran 5 heavy MongoDB Atlas aggregations every 5 minutes independently. Cold hit time: 2.7–3.2s.

**Fix 2:** Increased `STATS_TTL_MS` to `30 * 60 * 1000` (30 min). Cold DB hit now occurs once per worker per 30-min window instead of 12 times/hour. `?live=1` bypass still available for admins needing instant refresh.

**Root cause 3 — missing cache invalidation on volunteer approve/reject:**
`handleBoothPresidentAction` in `boothPresidentController.js` saved the request status but never called `invalidateStatsCache()`. After an admin approved or rejected a volunteer, the "Pending" badge on the dashboard would not update until the TTL expired.

**Fix 3:** Added `invalidateStatsCache()` call after `request.save()` in `handleBoothPresidentAction`. Also exported `invalidateStatsCache` from `adminController.js` so it can be imported cross-controller.

**Deployed files:**
- `/var/www/bjptn/backend/controllers/adminController.js` — warmStatsCache payload fix, TTL 30 min, invalidateStatsCache exported
- `/var/www/bjptn/backend/controllers/boothPresidentController.js` — invalidateStatsCache import + call

**Deploy method:** `pm2 reload bjptn-backend` (graceful, zero downtime). All 4 workers online. Warmup completed on all workers: `[Warmup] ✅ Stats cache warmed for Super Admin scope`.

**E2E verified:**
- Dashboard loaded correctly on first visit without clicking "Refresh Data" ✓
- Volunteer Requests: 43 total / 40 Pending displayed correctly ✓
- Incomplete Enquiries: 63 displayed correctly ✓
- All 4 PM2 workers online, both DBs CONNECTED ✓

---

## 2026-09-22 — TASK-26: Optional EPIC / No-EPIC registration path

**Bug fix:** Removed `if (!cleanEpic) return 400` guard in `volunteerRegister` (`boothPresidentController.js`) that blocked registrations without a Voter ID. The PND- placeholder fallback already existed but was unreachable.

**Feature:** Users can now register using district + assembly (no EPIC). System stores `epicNo: "PND-{mobile}"` as a placeholder satisfying MongoDB `required: true`. All scheme applications use this PND- epicNo.

**EPIC update flow:** Moved from chatbot login prompt → My Profile page. Users with a PND- EPIC see an "Add Your Voter ID" card in My Profile. On successful EPIC verification, `User.epicNo` is overwritten with verified voter data (name, district, assembly, booth), and all scheme applications are cascade-updated via `SchemeApplication.updateMany()`.

**Deployed files:**
- `/var/www/bjptn/backend/controllers/boothPresidentController.js` (removed EPIC guard, Sep 22 08:51)
- `/var/www/bjptn/dist/assets/index-DZ1sPKcj-v2.js` (TASK-26 frontend build, Sep 22)

**E2E verified:**
- New user (no EPIC): Mobile → OTP → District/Assembly → Confirm → Schemes → PND- placeholder stored ✓
- Returning PND- user: Login → My Profile → Add EPIC → Voter DB lookup → overwrite → cascade update ✓
- Original EPIC-first flow: completely unchanged ✓
- DB post-update: epicNo IOR0578971, voterName Achutharaman, SchemeApplication cascaded ✓

**Restarts:** pm2 reload bjptn-backend (4 cluster workers), all online, 23 total restarts (all from prior TASK-25 crash-loop, none new).

---

## 2026-09-23 — Fix: Double-start bug on WelcomeBannerMsg

**Bug:** Tapping "தொடங்கு" (Start) multiple times sent duplicate user messages and produced a blank bot avatar. Root cause: `WelcomeBannerMsg` had no `disabled` prop and `handleStart` had no state guard — the button remained fully clickable after the chatbot moved past WELCOME state.

**Fix (3 lines, `ChatbotPage.jsx`):**
- `WelcomeBannerMsg`: added `disabled` prop, applied to button element
- `handleStart`: added early-return guard `if (chatState !== S.WELCOME || isTyping) return`
- `renderMsgContent` case `welcome_banner`: passes `disabled={chatState !== S.WELCOME}`

**Also confirmed:** BJPTN-FRONTEND-1 (localStorage SecurityError) was already fixed in the Sep 22 build — `AuthContext` has `safeLS` wrapper. Sep 15 events were from old bundle `BX1`. Mark resolved in Sentry.

**Deployed:** `index-CAkT_oJ_-v2.js`, Sep 23. Backup: `dist_backup_doublestart_20260923`. All 4 bjptn-backend workers online, both DBs connected, 0 new restarts.

---

## 2026-09-22 — Comprehensive E2E Health Check

**All systems healthy as of 09:35 UTC:**
- PM2: 7 processes online — bjptn-backend (4 workers, 42m uptime), bjp-localbody-backend (6d), edm-backend (6d), vanigan-backend (6d)
- CPU: 1.3% | RAM: 50.4% | Disk: 6% (8.2G/154G)
- SSL: valid to Dec 9 2026
- MongoDB Atlas: CONNECTED (app_db + voter_db), 196 users, 499 scheme apps, 10 volunteers, 1 PND- user
- `/api/health` (direct port 5000): `{"status":"OK","databases":{"app_db":"CONNECTED","voter_db":"CONNECTED"}}`
- `/api/schemes/list`: 32 schemes ✓
- `/api/booth-president/jurisdictions`: 39 districts ✓
- `/api/update-epic` (no auth): 401 ✓
- `/api/send-otp` (bad input): 400 ✓
- Live site https://tnbjp.org: frontend loading, Tamil UI, scheme sidebar, chatbot all rendering ✓
- Other apps (bjp-localbody, edm-backend, vanigan-backend): 0 errors, 0 restarts ✓

**Known non-blocking issue:**
- Historical SyntaxError (`adminController.js:2440 exportAnalyticsExcel`) still in PM2 error log — remnant from TASK-25 crash-loop. Not actively crashing; workers stable since last reload. Recommend fixing separately.

**Domain note:** tnbjp.org (not .com) — nginx vhost `server_name tnbjp.org www.tnbjp.org tamilnadubjp.live www.tamilnadubjp.live`

---

## 2026-09-16 — Welfare card scheme overflow

PERF: Welfare card — unrestricted scheme titles exceeded the fixed portrait panel and were clipped → display up to six complete titles, measured against the available panel height, with a translated remaining-application count and a link to My Schemes → 20 local Chromium scenarios passed across English/Tamil, 360px/1440px widths, and 0/1/6/7/23 applications with long names and locations. Actual PNG downloads were generated and visually checked in both languages. Text sharing retains all applications. No backend or registration changes.

- Production build: passed (existing large-bundle warning).
- Regression harness: `frontend/tests/welfare-card.html`, `welfare-card.jsx`, and `welfare-card.cjs`; run with a local Vite server on port 3100 and an installed Playwright module (or `PLAYWRIGHT_MODULE` override). Fixtures use synthetic data and mocked scheme endpoints; they are excluded from the production build.
- Deployment: copy hashed frontend assets first and replace `index.html` last; preserve the previous entry point and assets for rollback. No process restart required.
- Released at 2026-09-16 13:36 UTC to `tnbjp.org`. Public HTML and JavaScript SHA-256 values matched the tested local build. `/api/health` reported both databases connected; all PM2 processes stayed online with unchanged restart counts. Previous build: `/var/www/bjptn/dist_backup_welfare_card_20260916`.

---

## 2026-10-02 — Logout dead on storage-blocked Android browsers

FIX: Frontend — `handleLogout` and the session-revoked handler called `sessionStorage.clear()` unguarded; on Android browsers/WebViews that deny storage it threw a SecurityError, so logout never reached its page reload (Sentry BJPTN-FRONTEND-5 error + FRONTEND-6 rage clicks, 4 events on 2026-10-01) → wrapped both calls in try/catch (commit `b8b7826`) → bundle diff vs previous build is exactly those 2 statements.

- Note: commit `954cbe7` (2026-09-30) only filtered `localStorage` SecurityErrors out of Sentry; it did not change app behaviour. Left as is; `sessionStorage` errors intentionally NOT filtered.
- Tests (local build preview + live): blocked storage → logout reloads, no errors; normal storage → token/cache cleared, back to start screen; control on old build reproduced the exact Sentry error and dead button.
- Deployment: new bundle uploaded first and md5-verified (server + Cloudflare), then `index.html` swapped atomically. Released 2026-10-02 06:32 UTC. Bundle `index-LFar8YyL-v2.js` (2,221,245 bytes). PM2 restart counts unchanged; 0 5xx.
- Rollback: `cp /var/www/bjptn/dist/index.html.pre-logoutfix /var/www/bjptn/dist/index.html` (previous bundle `index-Cd06a5r3-v2.js` still on server).

---

## 2026-10-02 — Admin dashboard booth voter counts (slow after restarts, blanks)

PERF: bjptn-backend — `GET /api/admin/dashboard-stats` took up to ~3.1s after restarts (Sentry BJPTN-BACKEND-4/8): `getBoothVoterRollCount` did a full COLLSCAN `$group` on PART_NO per assembly (~1.5s each under load, up to ~49 in parallel per worker), marked an assembly cached *before* its scan finished (concurrent callers got blank totals; a failed scan stayed blank until restart), evicted after 150 of 234 assemblies, and the startup `warmStatsCache` used a separate simplified payload (no booth voter totals, no top referrers, raw scheme names) served for up to 30 min → index-covered pipeline (`$sort`+`$project`+`$group` on PART_NO), in-flight promise per assembly, mark-loaded-after-success, max 4 concurrent scans per worker, no eviction; `warmStatsCache` now runs the real `getDashboardStats` handler and logs counts only → result below.

- Tests: `backend/tests/boothVoterCounts.test.js` (node --test, fake DB) 6/6 pass; same tests vs previous version fail 5/6 (blank under concurrency, stuck after failure, 30 parallel scans, eviction, pipeline).
- Read-only checks on live data: new vs old counts identical for 15,082 booths / 46 assemblies; single assembly 195→129ms, 10 parallel cold 933→628ms.
- Deployed 2026-10-02 09:19 UTC (12:49 IST) via staged upload + md5 check + atomic mv + `pm2 reload bjptn-backend` (7s, zero downtime, restarts 29→30 each). Warm-up log on all 4 workers: booth rows 100, with voter totals 90–91, top referrers 5 (previously 0/0). Memory ~200→~165 MB/worker. 0 errors, 0 5xx.
- Post-deploy: first real admin dashboard load 22ms (HTTP 200). Every admin role/scope returns 200; 57 booths across all scopes show "—" because the application's booth number is not in that assembly's roll (data issue, not code). Booth top-100 membership varies between loads when booths tie at the cutoff (pre-existing; totals for the same booth always identical).
- Rollback: `cd /var/www/bjptn/backend && cp services/jurisdictionService.js.pre-dashfix services/jurisdictionService.js && cp controllers/adminController.js.pre-dashfix controllers/adminController.js && pm2 reload bjptn-backend`
- Success check pending: 24h and 7d (dashboard p95 < 0.5s, max < 1.5s incl. after restarts; validate-epic p95 ≤ 0.25s; 0 new errors; no extra restarts; mem < 220 MB).

---

## 2026-10-02 — Referrals page, volunteer district map, volunteer access fixes

FEATURE: Admin (Super + State only) — new sidebar page "Referrals": Tamil Nadu district map of referrals credited to the REFERRER's own district, ranked referrer list filtered by clicking a district, Excel export (all / one district). Volunteer Requests page gets the same map with a pending/approved/rejected hover breakdown; clicking a district filters the list, dropdowns and export.
- Backend: `GET /api/admin/referral-map`, `/referrers`, `/export-referrers`, `/volunteer-map` (authorizeRoles SUPER_ADMIN, STATE_ADMIN). New `controllers/adminReferralController.js` (NOT `referralController.js`, which serves members' My Referrals), `utils/districtNormalizer.js` (backend copy of the frontend alias list — keep in sync). State Admin gets mobile/referral codes masked server-side (same rule as TopReferrersCard maskPII).
- Frontend: `TnDistrictMap` takes optional `districtStats`/`metric`/`title`/`hoverDetail`; with none it behaves exactly as before (dashboard verified unchanged). New `ReferralsView.jsx`.
- Fixed: volunteer district filter/export matched only one spelling (Villupuram showed 2 of 7, Sivagangai 1 of 6, Thiruvarur 1 of 3; export with a canonical name matched 0).

SECURITY: volunteer data access
- Volunteer list had no Booth Admin restriction (a Booth Admin calling the API saw all 226 statewide) → Booth Admin limited to own booth; scoped admin with missing area or unknown role → 403.
- Volunteer Excel export let a District/Assembly Admin replace their own area with any `district=`/`assemblyName=` → requested filters are now ANDed with the admin's own jurisdiction (can narrow, never widen).
- Approve/reject was already Super Admin only (unchanged).
- Note: no volunteer request stores a booth number, so Booth Admins now see 0 volunteers (correct).
- OPEN: District/Assembly/Booth admin passcodes are predictable formulas (authenticateDynamicAdmin) and dynamic tokens last 7 days with no revocation — separate plan pending.

Verification: 22 number/access checks + 17 security checks on live data (read-only, isolated test copy) and again against the live backend files after deploy — all pass; local e2e in Chrome; live UI check after deploy (both pages, district clicks, hover, exports, dashboard map unchanged, 0 console errors, phone width OK).
- Deployed 2026-10-02 10:52 UTC: backend staged + md5 + `pm2 reload bjptn-backend` (6s, zero downtime); frontend `index-BN49AWtv-v2.js` (2,231,551 bytes) uploaded first, `index.html` swapped last. 0 5xx, 0 new backend errors, 0 Sentry errors after deploy.
- Rollback: frontend `cp /var/www/bjptn/dist/index.html.pre-mapsfix /var/www/bjptn/dist/index.html`; backend `cd /var/www/bjptn/backend && for f in controllers/boothPresidentController.js controllers/adminController.js routes/adminRoutes.js; do cp $f.pre-mapsfix $f; done && pm2 reload bjptn-backend` (new files adminReferralController.js and utils/districtNormalizer.js are unused once routes are restored).

---

## 2026-10-02 — Device optimisation batch 1 (language switch, map labels, list text, checkboxes)

UX: audit at 360/390/768/1024/1440 px found no layout breakage (no sideways scroll anywhere) but 5 usability issues. Batch 1 fixes 4 of them (frontend only):
- #1 Member chat language switch (ChatbotPage `LanguageToggle`, inline styles): 33x19 / 55x19 px → 44x36 / 65x36 px, 11 → 13 px text, aria-pressed. Header height unchanged (109 px).
- #3 `TnDistrictMap`: in-map labels rendered at 4.3–5.9 px (badges 3.8 px) on phones → hidden when the map is < 420 px wide (colours, info bar and directory carry the data); count badges 7.5 → 9.5 (desktop ~8.2 px rendered); hint says "Tap…" on `(hover: none)` devices. Width tracked with a callback-ref ResizeObserver + immediate measurement (a mount-only effect missed node swaps and sometimes stayed in wide mode at 360 px — caught in testing).
- #5 District directory text 9.5–10.5 → 11–13 px.
- #4 All 5 admin dashboards: application checkbox cell is the tap target (38x66+ px, box 18 px); tapping it no longer risks opening member details; select-all header cell likewise; rest of the row still opens details.
- Deployed 2026-10-02 ~11:45 UTC: `index-BAFHGJWK-v2.js` (2,234,024 bytes) uploaded first, `index.html` swapped last. Verified live: member switch in mobile emulation, maps hidden/shown correctly on Dashboard/Referrals/Volunteers (waiting for all 38 districts to draw), checkbox tap, 0 console errors, 0 5xx, 0 Sentry.
- Rollback: `cp /var/www/bjptn/dist/index.html.pre-ux1 /var/www/bjptn/dist/index.html`.
- Not tested: real iPhone Safari; non-Super admin dashboards by click (identical code, applied by exact-match script).
- Pending (batch 2): #2 code-split admin out of the member bundle — members download ~610 KB gzip JS of which ~347 KB is admin-only (exceljs alone 920 KB raw); estimated member JS ~263 KB after split.
- Note: admin logins are single-session — logging in on a local copy that proxies to the live API logs out the live admin tab.
