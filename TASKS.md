# BJP Nalam Thittam — Task Planning

> Last updated: 2026-09-24
> Server: 168.144.219.177 (DigitalOcean, Ubuntu)
> App: bjptn-backend (4 PM2 cluster workers, port 5000)
> Frontend: React 18 + Vite, served from /var/www/bjptn/dist
> DB: MongoDB Atlas (bjp_nalam_thittam_db) + Local MongoDB (voter_db)
> GitHub: https://github.com/ramlakshman-org/tnbjporg (remote: backup)

---

## TASK-27 ✅ COMPLETED 2026-09-24 — Action Required Panel on Overview Dashboard

### Context
The Overview Dashboard (`getDashboardStats` API + `SuperAdminDashboard.jsx`) currently shows 4 stat cards:
Total Voters in Roll, Voters Enrolled in Schemes, Applications Submitted, Approved Directives.

Two high-priority data points are missing from the dashboard:
- **Volunteer Requests** — stored in `boothpresidentrequests` collection. Fields: status (Pending/Approved/Rejected), district, assemblyName, mobile, voterName, appliedAt.
- **Incomplete Enquiries** — stored in `IncompleteRegistration` collection. Fields: mobile, stage (OTP_VERIFIED / EPIC_VERIFIED), epicNo, voterName, district, assemblyName, createdAt.

Currently admins must navigate to the sidebar tab to see these numbers. There is no at-a-glance count on the dashboard.

### What to build
**Backend** (`backend/controllers/adminController.js` → `getDashboardStats`):
- Add 2 parallel `countDocuments` calls inside the existing `Promise.all` block:
  - `BoothPresidentRequest.countDocuments({ status: 'Pending', ...scopeQuery })` → `pendingVolunteers`
  - `BoothPresidentRequest.countDocuments({ ...scopeQuery })` → `totalVolunteers`
  - `IncompleteRegistration.countDocuments({})` → `totalIncomplete` (SUPER/STATE only; no scope filter needed)
- Add these to the `overview` object in the response payload.
- Cache is already 5 minutes (`STATS_TTL_MS`). No change needed there.

**Frontend** (`frontend/src/pages/admin/SuperAdminDashboard.jsx`):
- Add a new "Action Required" section below the existing 4-card grid and above the TN District Map.
- Two wide cards side by side:
  - **Volunteer Requests**: shows total count + pending count highlighted in orange. Click → navigates to `booth_presidents` tab.
  - **Incomplete Enquiries**: shows total count + stage breakdown (OTP done vs EPIC found). Click → navigates to `incomplete_registrations` tab.
- Only show Incomplete Enquiries card to SUPER_ADMIN and STATE_ADMIN (matches sidebar visibility).
- District/Assembly admins see only the Volunteer Requests card.

### Files to change
| File | Change |
|------|--------|
| `backend/controllers/adminController.js` | Add 2 count queries inside getDashboardStats Promise.all (~line 295) |
| `frontend/src/pages/admin/SuperAdminDashboard.jsx` | Add Action Required section after stat-cards-grid (~line 580) |

### Risks
- **Low**: Adding 2 `countDocuments` to an already cached endpoint. Cache TTL is 5 min so DB hit is minimal.
- **Low**: Scope query for `BoothPresidentRequest` must match how it's done in `getAdminBoothPresidentRequests` — verify field names (district, assemblyName) match the collection.
- **None**: Frontend-only UI change below the fold. Rollback = revert 1 JSX block.

### Success looks like
- Overview Dashboard loads and shows the new "Action Required" section.
- Volunteer Requests card shows correct total and pending count (verify against Volunteer Requests tab count).
- Clicking the card navigates directly to that tab.
- Incomplete Enquiries card visible to Super/State Admin only.
- No regression on existing 4 stat cards or the TN District Map below.
- API response time unchanged (still served from 5-min cache after first hit).

### Failure looks like
- Dashboard shows 0/0 for new cards when real data exists → scope query mismatch.
- Existing 4 stat cards break → syntax error in getDashboardStats payload block.
- Cards visible to District/Assembly admins who shouldn't see Incomplete Enquiries.

### Fallback
- If backend change causes issues: remove the 2 new count queries and hardcode `pendingVolunteers: null` in payload → frontend hides card when value is null.
- If frontend card breaks layout: wrap in `ErrorBoundary` (already used throughout dashboard).

### How to test
1. Login as Super Admin → Overview Dashboard → verify "Action Required" section appears.
2. Cross-check Volunteer Requests card number vs. Volunteer Requests tab → must match.
3. Click Volunteer Requests card → should navigate to `booth_presidents` tab.
4. Login as District Admin → verify Incomplete Enquiries card is NOT shown.
5. Check API: `curl http://localhost:5000/api/admin/dashboard-stats -H "Authorization: Bearer <token>"` → response should include `overview.pendingVolunteers` and `overview.totalIncomplete`.
6. Hit `?live=1` to bypass cache and confirm fresh counts.

---

## TASK-28 ✅ COMPLETED 2026-09-24 — Export Report on Volunteer Requests Page

### Context
The Volunteer Requests page (`frontend/src/components/BoothPresidentRequestsView.jsx`) already has:
- District filter dropdown
- Assembly filter dropdown (scoped to selected district)
- Status filter (Pending/Approved/Rejected)
- Search box
- Pagination (15 per page)

**What's missing:** No way to download/export filtered results. Admins need to share district-wise or assembly-wise volunteer lists as a report.

Export infrastructure already exists in the codebase:
- `exportApplicationsCsv` (line 1204 of adminController.js) — streams CSV with UTF-8 BOM
- `exportApplicationsExcel` (line 1302) — ExcelJS styled Excel file
- Both follow the same filter pattern: read scope from admin JWT + query params

The `boothpresidentrequests` collection has all needed fields:
`voterName, epicNo, mobile, gender, district, assemblyName, boothNo, status, rejectionReason, appliedAt, actionDate, actionBy`

### What to build
**Backend** (`backend/controllers/adminController.js`):
- New function `exportVolunteerRequestsExcel` following same pattern as `exportApplicationsExcel`.
- Accepts query params: `status`, `district`, `assemblyName` (matches existing filter API).
- Respects admin scope (District Admin sees only their district, Assembly Admin sees only their assembly).
- Output: styled Excel with columns: Name, EPIC No, Mobile, Gender, District, Assembly, Booth, Status, Applied Date, Action Date, Action By, Rejection Reason.

**Backend** (`backend/routes/adminRoutes.js`):
- Add route: `GET /api/admin/export-volunteer-requests` → `exportVolunteerRequestsExcel`

**Frontend** (`frontend/src/components/BoothPresidentRequestsView.jsx`):
- Add "⬇ Export Report" button next to the Refresh button in the header.
- On click: build URL with current active filters (`status`, `district`, `assemblyName`) + auth token → trigger file download.
- Show loading state on button while download in progress.
- Reuse same download trigger pattern as existing export in SuperAdminDashboard.

### Files to change
| File | Change |
|------|--------|
| `backend/controllers/adminController.js` | Add `exportVolunteerRequestsExcel` function |
| `backend/routes/adminRoutes.js` | Add GET route for export |
| `frontend/src/components/BoothPresidentRequestsView.jsx` | Add Export button + download handler |

### Risks
- **Low**: ExcelJS is already installed (`require('exceljs')` at line 1 of adminController.js). No new dependency.
- **Low**: Large exports (if all 234 assemblies × many volunteers). Mitigate: add `limit: 5000` cap server-side with a warning in the file if truncated.
- **Low**: Auth token must be sent as query param or header for file download (browser `<a href>` can't send headers). Use same pattern as existing export — token in query string, validated server-side.

### Success looks like
- "⬇ Export Report" button appears in Volunteer Requests page header.
- Clicking with no filters downloads all volunteer requests as Excel.
- Filtering by Chennai district + specific assembly → export contains only those records.
- Downloaded file opens correctly in Excel/Google Sheets with Tamil names rendering properly (UTF-8).
- File name format: `Volunteer_Requests_Chennai_2026-09-24.xlsx`
- Admins with District scope can only export their district's data (server enforces scope).

### Failure looks like
- Export returns 0 rows when data exists → scope query mismatch.
- Tamil names garbled in Excel → encoding issue (fix: ensure ExcelJS uses UTF-8, not latin1).
- Auth token rejected on export route → check token param name matches middleware expectation.
- Button triggers download but file is corrupted → ExcelJS stream error; check server logs.

### Fallback
- If server-side export has issues: switch to client-side CSV export (generate from currently loaded page data using `URL.createObjectURL`). Covers current page only but works instantly with no backend change.

### How to test
1. Go to Volunteer Requests tab as Super Admin.
2. Click Export with no filters → file downloads, open in Excel, verify row count matches "Total Applications" stat card.
3. Filter by a specific district → export → verify only that district's records are in file.
4. Filter by Status = Pending → export → verify all rows have status Pending.
5. Login as District Admin → export → verify file contains only their district.
6. Check server: `pm2 logs bjptn-backend --lines 20` → should show export request logged, no errors.

---

## TASK-29 ✅ COMPLETED 2026-09-24 — WhatsApp & Call Buttons on Volunteer Requests + Incomplete Enquiries

### Context
**Volunteer Requests** (`BoothPresidentRequestsView.jsx`): Each row has `mobile` field from `boothpresidentrequests`. Currently shows Name, EPIC, District, Assembly, Status, and Approve/Reject action buttons. No way to contact the person directly from the admin panel.

**Incomplete Enquiries** (`IncompleteRegistrationsView.jsx`): Each row has `mobile` field from `IncompleteRegistration`. Currently shows Mobile (masked), Stage, District, Assembly, Name (if EPIC verified), Date. No contact buttons.

The use case: Admin sees a Pending volunteer request or an incomplete registration and wants to follow up immediately via WhatsApp or phone — without copying the number manually.

Both collections store mobile as a 10-digit Indian number (no country code prefix).

### What to build
**Frontend only** — no backend changes needed.

**BoothPresidentRequestsView.jsx** — on each request row/card:
- Add `📞 Call` button → `<a href="tel:+91{mobile}">` (opens dialer on mobile, prompts on desktop)
- Add `💬 WhatsApp` button → `<a href="https://wa.me/91{mobile}" target="_blank">` (opens WhatsApp)
- Place these buttons alongside the existing Approve/Reject buttons.
- Style: small, outlined, consistent with existing action button style in the file.

**IncompleteRegistrationsView.jsx** — on each record row:
- Same two buttons: Call + WhatsApp using the `mobile` field.
- Note: `maskMobile` function currently exists (line 15) but returns the full number string (no actual masking). Buttons should use the raw `mobile` value.
- Place at the right end of each row.

### Files to change
| File | Change |
|------|--------|
| `frontend/src/components/BoothPresidentRequestsView.jsx` | Add Call + WhatsApp anchor buttons per row |
| `frontend/src/components/IncompleteRegistrationsView.jsx` | Add Call + WhatsApp anchor buttons per row |

### Risks
- **None**: Pure anchor tags, no state change, no API call, no backend touch.
- **Low UX**: On desktop, `tel:` opens OS default dialer (may prompt or do nothing). Acceptable — primary users are on mobile.
- **Low**: WhatsApp opens `wa.me` which requires the user to have WhatsApp installed. Fallback: wa.me handles this gracefully (shows install prompt).

### Success looks like
- Every row in Volunteer Requests shows a Call button and a WhatsApp button.
- Every row in Incomplete Enquiries shows the same.
- On mobile: tapping Call opens dialer with the number pre-filled.
- On mobile: tapping WhatsApp opens a WhatsApp chat with the person.
- No layout break on smaller screens (buttons wrap gracefully or are icon-only on mobile).
- Existing Approve/Reject buttons on Volunteer Requests rows are unaffected.

### Failure looks like
- `mobile` field is undefined on some rows → button shows `wa.me/91undefined`. Fix: guard with `{mobile && <a href=...>}`.
- Layout breaks on mobile with 4 buttons in one row → use icon-only buttons (phone icon, WhatsApp icon) with tooltip on mobile.

### Fallback
- If layout is too crowded: show buttons only on row expand/click (accordion pattern). No backend change.

### How to test
1. Open Volunteer Requests tab → verify Call and WhatsApp buttons appear on each row.
2. On mobile (or Chrome DevTools mobile emulation): tap Call button → dialer opens with correct number.
3. Tap WhatsApp button → WhatsApp opens (app or web) with that number pre-loaded.
4. Open Incomplete Enquiries tab → verify same buttons appear.
5. Check edge case: a row where mobile might be missing → button should not render (not crash).
6. Verify Approve/Reject buttons still work after the change.

---

## TASK-30 ✅ COMPLETED 2026-09-24 — Performance: dashboard-stats cache fix

### What was fixed
Three bugs in the dashboard-stats caching layer, discovered during a full end-to-end audit:

1. **warmStatsCache payload mismatch** — the startup warmup built `{ stats: { ... } }` while the live endpoint returns `{ overview: { ... }, districtStats: [...], ... }`. Dashboard showed blank Action Required cards on first load after any restart until admin clicked "Refresh Data".
2. **Cache TTL too short** — 5-min TTL meant each of 4 cluster workers ran 5 heavy Atlas aggregations every 5 minutes independently. Cold hit: 2.7–3.2s. Increased to 30 min.
3. **Missing cache invalidation on volunteer approve/reject** — `handleBoothPresidentAction` never called `invalidateStatsCache()`, so the Pending badge on the dashboard would not update after an approval until TTL expired.

### Files changed
| File | Change |
|------|--------|
| `backend/controllers/adminController.js` | warmStatsCache payload restructured to match getDashboardStats; STATS_TTL_MS 5→30 min; invalidateStatsCache added to module.exports |
| `backend/controllers/boothPresidentController.js` | Import invalidateStatsCache from adminController; call after request.save() |

### Verified
- Dashboard loads on first visit without Refresh Data ✓
- 43 Volunteer Requests / 40 Pending / 63 Incomplete shown correctly from warm cache ✓
- All 4 PM2 workers online after graceful reload ✓

---

## Deploy Plan (all 3 tasks)

### Order of implementation
1. **TASK-29 first** (smallest, no backend, instant value — 30 min)
2. **TASK-27** (backend + frontend, medium — 2h)
3. **TASK-28** (backend + frontend, largest — 2h)

### Deploy steps (each task)
```bash
# 1. Build frontend
cd /path/to/frontend && npm run build

# 2. Backup current dist on server
ssh root@168.144.219.177 "cp -r /var/www/bjptn/dist /var/www/bjptn/dist_backup_TASKXX_YYYYMMDD"

# 3. Upload assets first, index.html last
scp -r dist/assets/. root@168.144.219.177:/var/www/bjptn/dist/assets/
scp dist/index.html root@168.144.219.177:/var/www/bjptn/dist/index.html

# 4. If backend changed: reload PM2 (graceful, no downtime)
ssh root@168.144.219.177 "pm2 reload bjptn-backend"

# 5. Verify
ssh root@168.144.219.177 "curl -s http://localhost:5000/api/health && pm2 status --no-color"
```

### Rollback
```bash
# Restore previous dist
ssh root@168.144.219.177 "rm -rf /var/www/bjptn/dist && cp -r /var/www/bjptn/dist_backup_TASKXX_YYYYMMDD /var/www/bjptn/dist"

# If backend changed: restore file and reload
scp backend/controllers/adminController.js root@168.144.219.177:/var/www/bjptn/backend/controllers/
ssh root@168.144.219.177 "pm2 reload bjptn-backend"
```

---

## Current Server State (as of 2026-09-24 10:40 UTC)
- All 7 PM2 processes online
- bjptn-backend: 4 cluster workers, stable, 26 restarts (all historical — no new crashes)
- Error log: only historical entries from TASK-25 crash loop — no new errors
- CPU: 1.4% | RAM: 54% | Disk: 6%
- Both DBs: CONNECTED
- Frontend bundle: index-Bg8qLRUE-v2.js (deployed 2026-09-24, includes TASK-27 + TASK-28 + TASK-29)
- Root cause of today's outage: `exportAnalyticsExcel` undefined in adminRoutes.js (TASK-25 leftover). Fixed with stub function in adminController.js.
- PERF deploy 2026-09-24 10:39 UTC: warmStatsCache payload fix + TTL 30 min + invalidateStatsCache on volunteer action.

## Open Sentry Issues
- **BJPTN-BACKEND-4**: dashboard-stats cold query performance — RESOLVED 2026-09-24. TTL increased to 30 min; warmStatsCache payload fixed; invalidateStatsCache wired to volunteer approve/reject.
- **BJPTN-BACKEND-6**: SyntaxError ghost from TASK-25 pm2 reload. Historical noise in Sentry — server is clean. Can be resolved in Sentry.
- **BJPTN-BACKEND-7**: Route.get() undefined handler — RESOLVED by exportAnalyticsExcel stub fix 2026-09-24.
