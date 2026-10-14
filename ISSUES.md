# tnbjp.org — Application Issues Registry

**Audit Date:** 2026-09-19
**Audited by:** Claude Code (Comprehensive Audit + Live Server Reality Check)
**Total Issues:** 18 | Critical: 4 | High: 4 | Medium: 6 | Low: 4
**App is behind Cloudflare** (CF-Connecting-IP forwarding confirmed in nginx) — rate limiters see real client IPs.
**Current scale:** Small (~5K log lines, 325 KB out-log) — memory issues are future risk, not current fire.

---

## CRITICAL

---

### ISSUE-01 · Admin token revocation is broken
**Severity:** CRITICAL
**File:** `backend/models/Admin.js`, `backend/controllers/adminController.js:65`, `backend/middleware/authMiddleware.js:58`
**Status:** Open

**Reality Check (confirmed live):**
Deployed `Admin.js` has no `tokenVersion` field. Verified in the running code at `/var/www/bjptn/backend/models/Admin.js`. The schema ends at `createdAt` — no `tokenVersion`. In `authMiddleware.js:58` the revocation check reads:
```js
decoded.tokenVersion !== undefined && req.admin.tokenVersion !== undefined && decoded.tokenVersion !== req.admin.tokenVersion
```
Since `req.admin.tokenVersion` is always `undefined` (field absent from schema), this check is permanently skipped for every DB admin (SUPER_ADMIN, STATE_ADMIN). Dynamic booth/assembly admins (JWT-only, no DB record) also have no revocation mechanism.

**Impact:** Changing an admin password in DB does not invalidate any existing JWTs. A stolen admin token is valid for the full 7-day expiry with zero server-side mitigation. No way to force re-login.

**Fix:**
1. Add `tokenVersion: { type: Number, default: 1 }` to `adminSchema`.
2. In `adminLogin`, increment `admin.tokenVersion` on each successful login and `await admin.save()` before generating the token.
3. The existing check in `authMiddleware.js:58` then works automatically.

---

### ISSUE-02 · OTP logged in plaintext — ACTIVELY HAPPENING NOW
**Severity:** CRITICAL
**File:** `backend/services/smsService.js:22`
**Status:** Open — **confirmed live in PM2 logs**

**Reality Check (confirmed live):**
PM2 out-log on the server shows real OTPs with full mobile numbers RIGHT NOW:
```
[SMS Service] Attempting to send OTP 430513 to +918248085057 using 2Factor API...
[SMS Service] Attempting to send OTP 939231 to +917402146122 using 2Factor API...
[SMS Service] Attempting to send OTP 650105 to +918903628733 using 2Factor API...
[SMS Service] Attempting to send OTP 207953 to +919944995038 using 2Factor API...
```
(Actual OTPs and full mobile numbers visible in the 325 KB log file at `/root/.pm2/logs/bjptn-backend-out.log`.)
Every OTP ever sent since server start is recoverable from the log. The log is world-readable as root on this droplet.

**Impact:** Anyone with SSH/console access can authenticate as ANY user by reading the log. All historical OTPs since last server restart (3 days) are exposed.

**Fix:**
```js
// Remove the OTP from the log — only log destination and outcome
console.log(`[SMS Service] Sending OTP to +91...${cleanMobile.slice(-4)}`);
```

---

### ISSUE-03 · `updateApplicationStatus` has no scope enforcement
**Severity:** CRITICAL
**File:** `backend/controllers/adminController.js:1048`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
Deployed code at `/var/www/bjptn/backend/controllers/adminController.js`:
```js
const app = await SchemeApplication.findById(id);
if (!app) {
  return res.status(404).json({ success: false, message: 'Application record not found' });
}
// ...directly modifies app with no scope check
```
No `getAdminScopeQuery` is applied. A BOOTH_ADMIN for booth 5 in Madurai can update an application belonging to a voter in Chennai by knowing the MongoDB ObjectId.

**Impact:** Horizontal privilege escalation across the entire admin hierarchy. A low-trust BOOTH_ADMIN can approve, reject, or log calls on any application in the system.

**Fix:**
```js
const scopeQuery = getAdminScopeQuery(req.admin);
const app = await SchemeApplication.findOne({ _id: id, ...scopeQuery });
if (!app) return res.status(404).json({ success: false, message: 'Application not found or outside your scope' });
```

---

### ISSUE-04 · Excel export loads entire dataset into memory — OOM risk
**Severity:** CRITICAL
**File:** `backend/controllers/adminController.js:1455`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
Deployed line 1455:
```js
const allDocs = await SchemeApplication.find(appScopeFilter)
  .sort({ appliedAt: -1 })
  .select('voterName epicNo mobile ...')
  .lean();
```
No cursor, no streaming — full result set in memory. The CSV export (same file, same controller) uses `SchemeApplication.find(...).lean().cursor()` and iterates with `for await`. The Excel path does not.

**Current scale context:** At current scale this hasn't caused a crash yet (5K log lines, small dataset). As the campaign runs and applications grow, this will become a live OOM crash risk.

**Fix:** Convert to cursor streaming, identical pattern to the existing CSV export:
```js
const cursor = SchemeApplication.find(appScopeFilter).sort({ appliedAt: -1 })
  .select('voterName epicNo mobile district assemblyName boothNo schemeName clusterName status appliedAt')
  .lean().cursor();
for await (const doc of cursor) { ... }
```

---

## HIGH

---

### ISSUE-05 · SMS gateway failure returns `success: true` with `devOtp` — silent failure
**Severity:** HIGH *(revised down from CRITICAL — OTP not exposed in HTTP response in production)*
**File:** `backend/services/smsService.js:36-52`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
Both failure paths (non-success API response and thrown error) return:
```js
{ success: true, sessionId: 'MOCK_SESSION_...', devOtp: otp }
```
However, the HTTP response sent to users is controlled in `userChatController.js:59-65`:
```js
res.status(200).json({
  success: true,
  message: 'OTP sent successfully',
  mobile: cleanMobile,
  isExistingUser: !!existingUser,
  ...(process.env.NODE_ENV !== 'production' && { devOtp: otp })  // production guard
});
```
**The `devOtp` is NOT included in the HTTP response in production.** The OTP is not exposed to users through this path.

**Real problem:** When the SMS gateway is down, users receive a 200 OK ("OTP sent successfully") but no SMS arrives. The failure is completely invisible — no error state, no retry prompt. Users are stuck with a valid but undeliverable OTP session and no feedback.

**Impact:** Poor UX during SMS gateway outages. Currently not an OTP bypass security issue in production.

**Fix:**
Return `success: false` from `sendSmsOtp` on failure. The controller can then log the failure and still allow the OTP to be used (session is already saved), but should ideally inform the user to check if SMS arrives.

---

### ISSUE-06 · `/api/check-mobile` has no rate limit — mobile enumeration
**Severity:** HIGH
**File:** `backend/server.js` (rate limiter section)
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
Deployed `server.js` shows all rate limiters:
```js
app.use('/api/send-otp', otpLimiter);
app.use('/api/verify-otp', verifyLimiter);
app.use('/api/admin/login', loginLimiter);
app.use(['/api/validate-epic', '/api/voter/search-epic'], epicLimiter);
```
`/api/check-mobile` is **not in this list**. No rate limiter applied. The endpoint returns `{ registered: true/false }` to any caller with no throttling.

**Cloudflare context:** The site is behind Cloudflare, which provides some DDoS protection. However, Cloudflare does not block legitimate-looking enumeration requests — that's the application's responsibility.

**Impact:** Anyone can enumerate whether any mobile number is a registered BJP member at full speed without triggering any rate limit.

**Fix:**
```js
const checkMobileLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 20, message: rlMessage('Too many requests. Try again shortly.') });
app.use('/api/check-mobile', checkMobileLimiter);
```

---

### ISSUE-07 · Voter PII returned to unauthenticated callers
**Severity:** HIGH
**File:** `backend/routes/voterRoutes.js`, `backend/controllers/userChatController.js:185`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
`voterRoutes.js`:
```js
router.post('/search-epic', searchEpic);  // no auth middleware
router.post('/confirm-registration', confirmVoterRegistration);
```
`/api/validate-epic` (in `userChatRoutes.js`) is also unauthenticated. Both are behind the `epicLimiter` (30 requests per 10 minutes per IP), which is effective due to Cloudflare forwarding real IPs.

**What is returned:** voter name, district, assembly constituency, booth number, gender, age, father/relation name — for any EPIC number supplied.

**Rate limit context:** 30 lookups per 10 min per IP = 180/hour/IP = 4,320/day/IP. With 100 IPs, 432,000 voters per day can be profiled. The 56.8M TN voter roll would be fully enumerable in ~4 months with automated IPs.

**DPDP Act 2023 concern:** Voter PII returned without any consent or authentication. This is a direct compliance risk.

**Fix:**
Require a verified OTP session OR a user JWT before returning voter details:
```js
router.post('/search-epic', epicLimiter, requireVerifiedSession, searchEpic);
```

---

### ISSUE-09 · `distinct('mobile')` loads all mobiles into memory for statewide queries
**Severity:** HIGH *(issue 08 was revised down — see below)*
**File:** `backend/controllers/adminController.js:747`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
Deployed line 747:
```js
SchemeApplication.distinct('mobile', appScopeFilter),
```
This loads every distinct mobile string matching the scope into Node.js memory just to compute a count for the pagination UI. A statewide SUPER_ADMIN query with 50k+ applicants would load 50k strings into the PM2 worker heap.

**Current scale context:** At current scale (small dataset) this is not causing crashes. It will become a problem as the campaign scales up.

**Fix:**
```js
SchemeApplication.aggregate([
  { $match: appScopeFilter },
  { $group: { _id: '$mobile' } },
  { $count: 'total' }
]).then(r => r[0]?.total || 0)
```

---

## MEDIUM

---

### ISSUE-08 · `boothPresidentRoutes` dual-mount creates unintended endpoints under `/api/admin`
**Severity:** MEDIUM *(revised down from HIGH — all endpoints properly protected)*
**File:** `backend/server.js:171,175`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
Deployed `server.js` lines 171 and 175:
```js
app.use('/api/booth-president', boothPresidentRoutes);
app.use('/api/admin', boothPresidentRoutes);
```
Under `/api/admin` this creates:
- `POST /api/admin/apply` — requires **user JWT** (protectUser) — odd location, but safe
- `GET /api/admin/my-status` — requires **user JWT** (protectUser) — odd location, but safe
- `GET /api/admin/jurisdictions` — **public, no auth** — returns district/assembly list
- `GET /api/admin/booth-president-requests` — requires admin JWT — intended
- `POST /api/admin/booth-president-requests/:id/action` — requires admin JWT — intended

The `/api/admin/jurisdictions` public endpoint returns assembly metadata (same data as the public endpoint already used by the booth president form — not sensitive). All endpoints are properly authenticated with their original middleware.

**Reality:** No actual security bypass. The dual mount is deliberate for the admin endpoints. The concern is code hygiene and an unsanctioned public endpoint living under the `/api/admin` path.

**Fix:** Move the admin-only booth president routes into `adminRoutes.js` directly, and remove `app.use('/api/admin', boothPresidentRoutes)` from `server.js`.

---

### ISSUE-10 · CSV/Excel export scope uses exact string for DISTRICT_ADMIN baseline
**Severity:** MEDIUM
**File:** `backend/controllers/adminController.js:1203`, `:1307`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
Deployed CSV export (lines 8-10):
```js
if (admin.role === 'DISTRICT_ADMIN')    appScopeFilter.district     = admin.district;  // exact string
if (admin.role === 'ASSEMBLY_ADMIN')   appScopeFilter.assemblyName = admin.assemblyName;  // exact string
if (admin.role === 'BOOTH_ADMIN') { appScopeFilter.assemblyName = admin.assemblyName; appScopeFilter.boothNo = admin.boothNo; }
```
Lines 12-14 then optionally OVERRIDE with regex patterns if the user sends filter query params — but the baseline scope (lines 8-10) is exact-match only.

**Impact:** A DISTRICT_ADMIN whose stored `admin.district` is `"TIRUNELVELI"` but applications stored as `"Tirunelveli"` would get 0 rows in a CSV export, while the dashboard (which uses regex) shows records correctly. Inconsistency between dashboard and export.

**Fix:** Use regex for the baseline scope — same pattern as the dashboard:
```js
if (admin.role === 'DISTRICT_ADMIN') appScopeFilter.district = new RegExp('^' + escapeRegex(admin.district) + '$', 'i');
```

---

### ISSUE-11 · `getBoothVoterRoll` fetches all booth apps without `.lean()`
**Severity:** MEDIUM
**File:** `backend/controllers/adminController.js:1669`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
Deployed code:
```js
const allBoothApps = await SchemeApplication.find({
  district: new RegExp(...),
  assemblyName: new RegExp(...),
  boothNo: String(targetBooth)
}).select('epicNo status');
```
No `.limit()`, no `.lean()`. Mongoose hydrates full document objects for every application in the booth. The select limits fields but Mongoose still creates full Model instances.

**Real issue:** Missing `.lean()` — this creates unnecessary memory overhead. No limit is acceptable since all are needed for the category maps.

**Fix:** Add `.lean()`:
```js
}).select('epicNo status').lean();
```

---

### ISSUE-12 · Default schemes auto-registered if no schemes in request
**Severity:** MEDIUM
**File:** `backend/controllers/userChatController.js:359`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
```js
const targetSchemes = schemeIds || schemes || ['PM_KISAN', 'PM_UJJWALA', 'AYUSHMAN_BHARAT'];
```
**Practical context:** In production, this endpoint is called by the chatbot (always sends scheme IDs) and WhatsApp flow (always sends scheme IDs). A direct API call without schemes is the only real risk vector.

**Impact:** If someone calls `/api/register-schemes` directly without a scheme list, 3 schemes are auto-registered without user selection. Low practical risk given the current call patterns.

**Fix:**
```js
const targetSchemes = (schemeIds || schemes || []).filter(Boolean);
if (!targetSchemes.length) {
  return res.status(400).json({ success: false, message: 'At least one scheme must be selected.' });
}
```

---

### ISSUE-13 · Warm cache stores different payload shape than live `getDashboardStats`
**Severity:** MEDIUM
**File:** `backend/controllers/adminController.js:2125-2135`
**Status:** Open — **confirmed in deployed code, actively broken**

**Reality Check (confirmed live):**
`warmStatsCache` (server startup) stores:
```js
{ success: true, stats: { totalApplications, totalVotersRequested, ..., districtStats, assemblyStats, ... } }
```
But `getDashboardStats` (live handler) returns:
```js
{ success: true, adminRole, jurisdiction, overview: { totalUsers, ... }, districtStats, assemblyStats, ... }
```
**These are entirely different shapes.** The warmed cache wraps everything under `stats:{}`. The live handler uses `overview:{}` and flat `districtStats`, `assemblyStats` at the top level.

**Impact:** For 5 minutes after every server restart, the SUPER_ADMIN dashboard receives a malformed response. The frontend reads `data.overview.totalApplications` but gets `undefined` because the warmed response has `data.stats.totalApplications`. Stats display silently shows nothing/zeros for those 5 minutes. Since PM2 has had 3 restarts in 3 days, this breakage happens regularly.

**Fix:** Either align the warmup payload shape with the live handler's payload, or skip caching the warm-up result (let the first real request populate the cache correctly).

---

### ISSUE-14 · `deleteMember` missing ObjectId cast + missing cache invalidation
**Severity:** MEDIUM
**File:** `backend/controllers/adminController.js:2176`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
```js
const { userId } = req.params;
const user = await User.findById(userId).lean();       // Mongoose auto-casts — works
await SchemeApplication.deleteMany({ userId });         // string passed to ObjectId field
await User.findByIdAndDelete(userId);                   // Mongoose auto-casts — works
// ← no invalidateStatsCache() call
```
**Mongoose auto-casting:** `User.findById` and `User.findByIdAndDelete` auto-cast correctly. `SchemeApplication.deleteMany({ userId })` — Mongoose 6+ also auto-casts `ObjectId` fields, so the applications ARE deleted correctly in practice.

**Real bug:** `invalidateStatsCache()` is **not called** after deletion. The admin dashboard continues showing the deleted member in application counts for up to 5 minutes.

**Fix:**
```js
await SchemeApplication.deleteMany({ userId: new mongoose.Types.ObjectId(userId) });
await User.findByIdAndDelete(userId);
invalidateStatsCache();  // ← add this
```

---

## LOW

---

### ISSUE-15 · CSP uses `'unsafe-eval'` — XSS protection weakened
**Severity:** LOW
**File:** Live nginx config at `/etc/nginx/sites-enabled/bjptn.conf`
**Status:** Open — **confirmed in live nginx config**

**Reality Check (confirmed live):**
All location blocks in the live nginx config include:
```nginx
Content-Security-Policy "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'; ..."
```
`'unsafe-eval'` is present in all 4 location blocks (`/schemes/`, `/uploads/`, `/assets/`, `/`).

**Cloudflare context:** Cloudflare is in front but does not block content based on CSP — CSP is enforced by browsers, not proxies. `'unsafe-eval'` allows any script to call `eval()`, `new Function()`, or `setTimeout(string)` — a working XSS payload can execute arbitrary code despite the CSP.

**Fix:** Remove `'unsafe-eval'`. Vite-built React doesn't need it. Test after removal to confirm nothing breaks.

---

### ISSUE-16 · `GET /` exposes full API endpoint map unauthenticated
**Severity:** LOW
**File:** `backend/server.js:140-167`
**Status:** Open — **confirmed in deployed code**

**Reality Check (confirmed live):**
The root endpoint returns `backend_url`, `frontend_url`, `database_connections` (with DB names), and all API endpoint paths. This is accessible to anyone who calls `https://tnbjp.org/api/` directly.

**Context:** The app is behind Cloudflare, reducing casual exposure. The endpoint paths are standard REST conventions so not much is revealed that couldn't be guessed. Still unnecessary disclosure.

**Fix:**
```js
res.json({ status: 'ONLINE', version: '1.0.0' });
```

---

### ISSUE-17 · `Admin.tokenVersion` always resolves to 1 (downstream of ISSUE-01)
**Severity:** LOW
**File:** `backend/controllers/adminController.js:65`
**Status:** Open — **confirmed, downstream of ISSUE-01**

**Reality Check:**
`generateAdminToken`:
```js
tokenVersion: admin.tokenVersion || 1
```
Since the Admin model has no `tokenVersion` field, `admin.tokenVersion` is always `undefined`, so this always embeds `tokenVersion: 1` in every admin JWT ever issued.

**This is fully resolved by fixing ISSUE-01.** Once `tokenVersion` is in the schema with `default: 1`, this line works correctly and no separate change is needed here.

---

### ISSUE-18 · Assembly voter count cache key normalisation — FALSE ALARM
**Severity:** LOW → **NOT A REAL BUG**
**File:** `backend/services/jurisdictionService.js:77`
**Status:** Closed — no fix needed

**Reality Check (confirmed live):**
```js
// Write:
assemblyVoterCount[assemblyName.toUpperCase()] = voterCount;   // line 77

// All reads:
getAllAssemblyVoterCounts() → return assemblyVoterCount (keys already uppercase)
getAssemblyVoterRollCount(name) → assemblyVoterCount[name.toUpperCase()]  // line 263
getDistrictVoterRollCount → iterates districtCollectionMap (uppercase keys)
```
All three write and all read paths consistently use `.toUpperCase()`. There is no inconsistency in current code. This was a hypothetical concern about future code, not an actual bug.

**Closing this issue — no action needed.**

---

## Summary

| ID | Severity | Issue | File | Status |
|----|----------|-------|------|--------|
| ISSUE-01 | CRITICAL | Admin token revocation broken — no `tokenVersion` in Admin model | `models/Admin.js` | Open |
| ISSUE-02 | CRITICAL | OTP logged in plaintext to PM2 logs — **happening right now** | `services/smsService.js:22` | Open |
| ISSUE-03 | CRITICAL | `updateApplicationStatus` no scope check — any admin edits any app | `controllers/adminController.js:1048` | Open |
| ISSUE-04 | CRITICAL | Excel export loads full dataset into memory — OOM risk as data grows | `controllers/adminController.js:1455` | Open |
| ISSUE-05 | HIGH | SMS gateway failure returns `success: true` — failure is invisible | `services/smsService.js:36` | Open |
| ISSUE-06 | HIGH | `/api/check-mobile` has no rate limit — mobile enumeration | `server.js` | Open |
| ISSUE-07 | HIGH | Voter PII (name, district, booth, age) returned to unauthenticated callers | `controllers/voterController.js:16` | Open |
| ISSUE-08 | MEDIUM | `boothPresidentRoutes` dual-mount — code hygiene, all endpoints properly authed | `server.js:171,175` | Open |
| ISSUE-09 | HIGH | `distinct('mobile')` loads all mobiles into memory for statewide queries | `controllers/adminController.js:747` | Open |
| ISSUE-10 | MEDIUM | CSV/Excel export baseline scope uses exact string, not regex (DISTRICT_ADMIN) | `controllers/adminController.js:1203,1307` | Open |
| ISSUE-11 | MEDIUM | `getBoothVoterRoll` missing `.lean()` on booth apps fetch | `controllers/adminController.js:1669` | Open |
| ISSUE-12 | MEDIUM | Default schemes auto-registered if no schemes provided in request | `controllers/userChatController.js:359` | Open |
| ISSUE-13 | MEDIUM | Warm cache shape ≠ live response shape — SUPER_ADMIN dashboard broken after restart | `controllers/adminController.js:2125` | Open |
| ISSUE-14 | MEDIUM | `deleteMember` missing `invalidateStatsCache()` after deletion | `controllers/adminController.js:2176` | Open |
| ISSUE-15 | LOW | CSP contains `'unsafe-eval'` in all nginx location blocks | `nginx /etc/nginx/sites-enabled/bjptn.conf` | Open |
| ISSUE-16 | LOW | `GET /` exposes API map, DB names, backend URL unauthenticated | `server.js:140` | Open |
| ISSUE-17 | LOW | `Admin.tokenVersion` always 1 — downstream of ISSUE-01, fixed by same change | `controllers/adminController.js:65` | Open |
| ISSUE-18 | LOW | Assembly cache key normalisation — **FALSE ALARM, no bug** | `services/jurisdictionService.js:77` | Closed |

---

## Notes from Reality Check

**Positive findings:**
- App is behind Cloudflare with proper `real_ip_header CF-Connecting-IP` — rate limiters see real client IPs correctly
- HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy all present on every nginx location block
- CSV export correctly uses a streaming cursor — memory safe
- Mongoose auto-casting handles `deleteMember` correctly in practice (Mongoose 6+)
- ISSUE-05 severity reduced: `devOtp` is never sent in HTTP responses in production (guarded by `NODE_ENV !== 'production'`)
- ISSUE-08 severity reduced: all booth president routes are properly auth-protected with their intended middleware
- ISSUE-18 closed: all callers consistently normalise assembly names to uppercase

**Most urgent right now (in order):**
1. **ISSUE-02** — Real OTPs are in the PM2 log right now. Fix first.
2. **ISSUE-03** — Any authenticated admin can modify any application. Fix second.
3. **ISSUE-01** — Admin tokens can never be revoked. Fix third.
4. **ISSUE-04** — Excel export is a time bomb as data grows. Fix fourth.

---

*Update `Status` to `Fixed` when resolved. Add `Fixed Date` and `Fix Commit` columns as fixes land.*
