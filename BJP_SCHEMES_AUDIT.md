# BJP Nalam Thittam — SE III Security & Quality Audit
**Date:** 2026-10-14  
**Scope:** Full codebase — `backend/` (Node/Express + MongoDB) + `frontend/` (React/Vite)  
**Analyst role:** Software Engineer III (security-focused, read-only static analysis)  
**Previous audits read:** `output/AUDIT_2026-10-02.md`, `SECURITY_AUDIT.md`, `output/bjp_wacto_audit_2026-10-09.md`  
**Method:** Complete file-by-file read of all JS/JSX/config/route/model/service/middleware files in the ZIP. No code changed. No live requests made.

---

## 📊 Scoring Summary

| Domain | Max | Score | Grade |
|---|---|---|---|
| **Authentication & Session** | 20 | 9 | 🟡 |
| **Authorisation / RBAC** | 20 | 8 | 🟡 |
| **Input Validation & Injection** | 15 | 8 | 🟡 |
| **Data Exposure & PII** | 15 | 4 | 🔴 |
| **Secrets & Configuration** | 10 | 1 | 🔴 |
| **Rate Limiting & Abuse** | 5 | 2 | 🟡 |
| **Security Headers & Transport** | 5 | 3 | 🟢 |
| **Test Coverage** | 5 | 1 | 🔴 |
| **Dependency Hygiene** | 5 | 2 | 🟡 |
| **Total** | **100** | **38** | 🔴 **FAIL** |

> **38 / 100.** The infrastructure skeleton is solid (Helmet, mongoSanitize, bcrypt, CORS allowlist, HMAC webhook verification, token-version revocation, escapeRegex helpers). However two critical secrets are fully exposed in the committed `.env`, and three critical access-control gaps remain open from the October-02 audit — one of which gives any internet user read access to 5.68 crore voter records. These dominate the score.

---

## Severity Index

| ID | Severity | Short name | File(s) |
|---|---|---|---|
| S1 | 🔴 CRITICAL | Live `.env` committed with all production secrets | `.env` |
| S2 | 🔴 CRITICAL | Dynamic admin passwords are a guessable formula | `jurisdictionService.js` |
| S3 | 🔴 CRITICAL | Booth voter roll: any admin can read any booth in TN | `adminController.js` |
| S4 | 🔴 CRITICAL | Area-scope filter overwrite: lower-tier admins read/export cross-area | `adminController.js` |
| S5 | 🔴 CRITICAL | `POST /api/register-schemes` is fully unauthenticated write | `userChatRoutes.js` |
| S6 | 🔴 CRITICAL | `DYNAMIC_*` admin tokens are never revoked (no tokenVersion check) | `authMiddleware.js` |
| S7 | 🟠 HIGH | OTP generated with `Math.random` (not CSPRNG) | `userChatController.js` |
| S8 | 🟠 HIGH | OTP stored in plain text in MongoDB | `OtpSession.js` |
| S9 | 🟠 HIGH | PII (mobile) written to PM2 stdout log | `userChatController.js:345` |
| S10 | 🟠 HIGH | Rate limiters use in-process store — 4× weaker across PM2 workers | `server.js` |
| S11 | 🟠 HIGH | BJP-Wacto endpoints are fully open unauthenticated POSTs | `bjpWactoRoutes.js` |
| S12 | 🟠 HIGH | WhatsApp webhook skips HMAC if `META_APP_SECRET` is absent | `whatsappWebhook.js:40` |
| S13 | 🟠 HIGH | No npm test script; zero unit/integration coverage of auth paths | `package.json` |
| S14 | 🟠 HIGH | Vulnerable dependencies (9 HIGH backend, 11 HIGH frontend) | `package.json` |
| S15 | 🟡 MEDIUM | `devOtp: otp` field sent in non-production responses | `userChatController.js:65` |
| S16 | 🟡 MEDIUM | Dev bypass OTP `123456` active outside production | `userChatController.js:99` |
| S17 | 🟡 MEDIUM | Referral code generated with `Math.random` (not CSPRNG) | `userChatController.js:360` |
| S18 | 🟡 MEDIUM | JWT tokens (7-day) stored in `localStorage` — XSS-exposed | `AuthContext.jsx`, `ChatbotPage.jsx` |
| S19 | 🟡 MEDIUM | CSP: `unsafe-inline` + `unsafe-eval` in nginx — negates XSS protection | `bjptn_nginx.conf:15` |
| S20 | 🟡 MEDIUM | `POST /api/voter/confirm-registration` has no auth | `voterRoutes.js:6` |
| S21 | 🟡 MEDIUM | `POST /api/validate-epic` returns father/mother name, age, gender — unauthenticated | `userChatRoutes.js:20` |
| S22 | 🟡 MEDIUM | `POST /api/voter/search-epic` leaks last-4 of registered mobile | `voterController.js` |
| S23 | 🟡 MEDIUM | Export endpoint: `limitNum = 500000` with no row cap or streaming | `adminController.js:686` |
| S24 | 🟡 MEDIUM | `findSchemeByName` builds regex from unescaped WACTO input (ReDoS) | `bjpWactoController.js` |
| S25 | 🟡 MEDIUM | Registration trusts browser-supplied district/assembly/booth (no server re-validation) | `userChatController.js` |
| S26 | 🟡 MEDIUM | OTP session not deleted after successful verification | `userChatController.js` |
| S27 | 🟡 MEDIUM | Race condition: duplicate registration possible (no atomic upsert on mobile) | `userChatController.js` |
| S28 | 🟡 MEDIUM | `Sentry DSN` hardcoded in `server.js` — leaks org/project metadata | `server.js:10` |
| S29 | 🔵 LOW | `waDiag.sh` shell script committed with no chmod guard | `scripts/waDiag.sh` |
| S30 | 🔵 LOW | Seeding scripts committed to repo (`seedScreenshot1Data.js`, etc.) | `scripts/` |
| S31 | 🔵 LOW | `dist.tar.gz` (34 MB built bundle) committed to git | `frontend/dist.tar.gz` |
| S32 | 🔵 LOW | `tn-assemblies.geojson` (1.4 MB) shipped in both `dist/` and `public/` | `frontend/` |
| S33 | 🔵 LOW | No `package-lock.json` integrity pinning enforced in CI | repo-wide |
| S34 | 🔵 LOW | `Math.random` referral code collision retry loop (no max attempts) | `userChatController.js:358` |
| S35 | 🔵 LOW | `health` endpoint exposes internal DB topology (connected/disconnected state) to public | `server.js` |

---

## CRITICAL

---

### S1 🔴 — Live `.env` Committed With All Production Secrets

**File:** `backend/.env`

The entire production `.env` is committed to the repository and present in the ZIP. Every secret is exposed:

| Secret | Value type | Risk |
|---|---|---|
| `JWT_SECRET` | 96-char hex | Anyone can forge admin/user tokens |
| `MONGO_VOTER_URL` | Atlas connection string with credentials | Direct DB access to 13.7L voter records |
| `SMS_API_KEY` | 2Factor UUID | Unlimited SMS at your cost |
| `CLOUDINARY_API_SECRET` | 28-char string | Image upload/delete/transform |
| `META_APP_SECRET` | 32-char hex | Forge WhatsApp webhook payloads |
| `META_ACCESS_TOKEN` | Long-lived token | Send WhatsApp messages as your number |
| `FLOW_PRIVATE_KEY` | RSA-2048 PEM | Decrypt all WhatsApp Flow sessions |
| `SUPER_ADMIN_PASSWORD` | Plaintext | Immediate super-admin access |
| `STATE_ADMIN_PASSWORD` | Plaintext | Immediate state-admin access |
| `DISTRICT_ADMIN_PASSWORD` | Plaintext | Immediate district-admin access |

**Why it matters:** Anyone who has or had access to this ZIP — or the git repo before it was made private — owns the entire system: voter data, admin portal, WhatsApp channel, SMS budget. This supersedes every other finding.

**Test prompt:**
```
Audit S1 — Committed .env
1. Verify `backend/.env` exists in the git history: `git log --all --full-history -- backend/.env`
2. Confirm the JWT_SECRET in `.env` matches the one the live server uses: 
   compare `echo $JWT_SECRET` on the droplet with the value in `.env`.
3. Forge a valid admin JWT using the exposed JWT_SECRET (offline, no live call):
   node -e "require('jsonwebtoken').sign({id:'DYNAMIC_omalur_admin',isAdmin:true,role:'DISTRICT_ADMIN',tokenVersion:1},'<JWT_SECRET>',{expiresIn:'7d'})" 
   Expected result: a valid admin token is produced. Severity confirmed.
4. Verify MongoDB Atlas accepts the MONGO_VOTER_URL credentials from a machine 
   outside DigitalOcean (requires checking Atlas IP whitelist settings).
5. Check git history for `.env` removal commit — confirm `git rm --cached` was done 
   AND a new commit was pushed. Simply .gitignore-ing the file after commit does not 
   remove it from history.
Pass: none of the above produces access. Fail: any credential still valid.
```

---

### S2 🔴 — Dynamic Admin Passwords Are a Guessable Formula

**File:** `backend/services/jurisdictionService.js:89,117,152`

Password generation:
```
District admin: 60228001 + districtIndex
Assembly admin: 60227000 + assemblyNo
Booth admin:    60227680 + boothNo
```
Usernames follow `<slug>_admin` / `<slug>_b<N>` patterns.

**Test prompt:**
```
Audit S2 — Predictable dynamic admin credentials
1. Locate all dynamic username/password generation in jurisdictionService.js.
2. For assembly 17 ("OMALUR"), compute: username="omalur_admin", password=String(60227000+17)="60227017"
3. POST /api/admin/login with {"username":"omalur_admin","password":"60227017"}
   Expected: HTTP 200 with a valid admin JWT. Severity confirmed.
4. Verify the same formula login works for at least 3 different assemblies.
5. Check whether `DYNAMIC_*` tokens are checked for tokenVersion in authMiddleware.js 
   (they are not — lines 40–50 skip the tokenVersion check for DYNAMIC_ prefixed ids).
Pass: dynamic logins rejected / formula removed. Fail: any formula login returns 200.
```

---

### S3 🔴 — Booth Voter Roll Readable Across Entire State

**File:** `backend/controllers/adminController.js:1654-1655`

```js
targetBooth = req.query.boothNo || admin.boothNo;
targetAssembly = req.query.assemblyName || admin.assemblyName;
```

`admin.boothNo` / `admin.assemblyName` are **defaults**, not enforcement. A request with different `?boothNo=&assemblyName=` returns another booth's voter roll. No boundary check.

**Test prompt:**
```
Audit S3 — Cross-booth voter roll access
1. Log in as booth admin for OMALUR booth 17 (see S2 for credentials).
2. GET /api/admin/booth-voter-roll?assemblyName=CHENNAI CENTRAL&boothNo=1&page=1
   Expected: HTTP 200 with CHENNAI CENTRAL voter data. Severity confirmed.
3. Script a loop: for boothNo in {1..50}; paginate all pages for assemblyName=CHENNAI CENTRAL.
   Expected: complete voter roll of another assembly delivered.
4. Verify response includes: voterName, relationName, houseNo, age, gender, mobile (where registered).
Pass: 403 returned for out-of-scope booths. Fail: any cross-scope voter data returned.
```

---

### S4 🔴 — Area-Scope Filter Overwrite in List and Export Endpoints

**File:** `backend/controllers/adminController.js:695-697` (list), `:1220-1222` (CSV), `:1321-1323` (Excel)

```js
if (isValidFilterVal(district)) appScopeFilter.district = new RegExp('^' + escapeRegex(...) + '$', 'i');
```

`appScopeFilter.district` is set to the **request query value**, overwriting the admin's own district. A booth admin can export all members in any district.

**Test prompt:**
```
Audit S4 — Area scope filter bypass
1. Log in as booth admin OMALUR B17 (limited scope).
2. GET /api/admin/applications?district=CHENNAI&assemblyName=ROYAPURAM&boothNo=1
   Expected: applications from ROYAPURAM Chennai, not OMALUR.
3. GET /api/admin/export-excel?district=CHENNAI (all booths)
   Expected: full Excel export across another district delivered to a booth-level token.
4. Confirm the response includes mobile, EPIC, voterName fields.
Pass: 403 / empty result for out-of-scope params. Fail: cross-area data returned.
```

---

### S5 🔴 — `POST /api/register-schemes` is an Unauthenticated Write

**File:** `backend/routes/userChatRoutes.js:24`

```js
router.post('/register-schemes', registerSchemes);  // no protectUser
```

This endpoint creates `User` records and `SchemeApplication` records with a caller-supplied `referredBy` value. No OTP verification is required at call time; the endpoint accepts a mobile number and proceeds.

**Test prompt:**
```
Audit S5 — Unauthenticated write to register-schemes
1. Without any JWT token, POST /api/register-schemes with body:
   { "mobile": "9999999999", "epic_no": "ABC1234567", "voter_name": "Test", 
     "district": "CHENNAI", "assemblyName": "ROYAPURAM", "boothNo": "1",
     "referredBy": "<any existing referral code>" }
2. Expected: HTTP 200, new User record created, referral count inflated.
3. Repeat with 100 different mobile numbers — verify 100 users are created with no auth.
Pass: 401 returned without valid JWT. Fail: records created.
```

---

### S6 🔴 — `DYNAMIC_*` Admin Tokens Are Never Revoked

**File:** `backend/middleware/authMiddleware.js:40-50`

```js
if (String(decoded.id).startsWith('DYNAMIC_')) {
  req.admin = { _id: decoded.id, ... };  // set from token only
}
// tokenVersion check never runs for DYNAMIC_ tokens
```

DB-backed admins have `tokenVersion` invalidation. Dynamic admins do not: a stolen token works for its full 7-day lifetime with no way to revoke it.

**Test prompt:**
```
Audit S6 — DYNAMIC token irrevocability
1. Obtain a valid DYNAMIC admin token (see S2).
2. Note the token's exp claim.
3. Confirm there is no DB record for this admin (SELECT * from admins where username='omalur_admin').
4. Change the expected formula password in jurisdictionService.js (simulate rotation).
5. Re-send the original token to GET /api/admin/dashboard-stats.
   Expected: HTTP 200 — old token still works despite "rotation".
Pass: old token rejected after credentials change. Fail: old token still accepted.
```

---

## HIGH

---

### S7 🟠 — OTP Generated With `Math.random` (Not CSPRNG)

**File:** `backend/controllers/userChatController.js:26`

```js
const otp = Math.floor(100000 + Math.random() * 900000).toString();
```

`Math.random` is not a CSPRNG. In V8, the state is seeded once per isolate and the output is partially predictable from a small sample.

**Test prompt:**
```
Audit S7 — Non-cryptographic OTP generation
1. Trigger 20 consecutive OTPs for the same mobile in quick succession (dev env).
2. Record all OTP values returned in devOtp or via SMS.
3. Run a V8 Math.random state recovery tool (e.g. https://github.com/d0nutptr/v8_rand_buster).
   Expected: future OTPs can be predicted from the sample.
4. Compare: replace with crypto.randomInt(100000, 999999) and verify uniform distribution.
Pass: OTP generated with crypto module. Fail: Math.random used.
```

---

### S8 🟠 — OTP Stored in Plain Text in MongoDB

**File:** `backend/models/OtpSession.js:9`

```js
otp: { type: String, required: true }
```

A MongoDB compromise or snapshot exposes all live OTPs directly. OTPs should be stored as a bcrypt hash (cost 8 is sufficient for a 6-digit value).

**Test prompt:**
```
Audit S8 — Plain-text OTP in database
1. Trigger an OTP send for any mobile.
2. Query MongoDB: db.otpsessions.findOne({mobile: "..."})
   Expected: otp field contains the raw 6-digit code.
3. Confirm no hashing is applied before the save() in userChatController.js.
Pass: otp field is a bcrypt hash. Fail: raw digits are stored.
```

---

### S9 🟠 — PII Written to PM2 Stdout Log

**File:** `backend/controllers/userChatController.js:345`

```js
console.log('[registerSchemes] mobile=%s referredBy=%s', cleanMobile, incomingRef || '(none)');
```

Mobile number (personal data under DPDP Act 2023) is written to process stdout / PM2 log files in plain text. Log aggregation tools like Sentry or any log storage would capture it.

**Test prompt:**
```
Audit S9 — PII in application logs
1. POST /api/register-schemes with a known mobile number.
2. Check PM2 log: pm2 logs bjp-backend --nostream --lines 20
   Expected: log line contains the exact mobile number.
3. Check Sentry (server.js:10 DSN) for any mobile numbers in breadcrumbs.
Pass: mobile number masked or absent from logs. Fail: raw mobile visible.
```

---

### S10 🟠 — Rate Limiters Use In-Process Memory Store Across 4 PM2 Workers

**File:** `backend/server.js:98-148`

`express-rate-limit` defaults to an in-memory store. With 4 PM2 workers, each worker holds its own counter. Effective limits are:

| Endpoint | Configured | Effective (4 workers) |
|---|---|---|
| `/api/send-otp` | 6/10 min | 24/10 min |
| `/api/admin/login` | 15/15 min | 60/15 min |
| `/api/validate-epic` | 10/10 min | 40/10 min |

**Test prompt:**
```
Audit S10 — Rate limit bypass via worker distribution
1. Send OTP requests from the same IP in a loop, counting responses until 429.
2. Compare actual limit before 429 vs. configured max (6).
   Expected: 429 returned after 24+ requests (4× the configured 6).
3. Use a load-balancer-aware tool (wrk, k6) to send requests that hit different workers.
Pass: shared rate-limit store (Redis/MongoDB TTL) in use. Fail: limits are 4× configured.
```

---

### S11 🟠 — BJP-Wacto Endpoints Are Open Unauthenticated POSTs

**File:** `backend/routes/bjpWactoRoutes.js`

All five routes (`/register`, `/volunteer`, `/profile`, `/referral`, `/members`, `/events`) accept unauthenticated POST requests. Anyone knowing the URL can create `User`, `SchemeApplication`, and `BoothPresidentRequest` records for any phone number.

**Test prompt:**
```
Audit S11 — Unauthenticated BJP-Wacto writes
1. POST /api/whatsapp/bjp-wacto/register with body:
   { "phone": "919999999999", "epic": "ABC1234567", "name": "Injected", 
     "district": "CHENNAI", "assembly": "ROYAPURAM", "booth": "1" }
   Expected: HTTP 200, new User or SchemeApplication created.
2. POST /api/whatsapp/bjp-wacto/events with body:
   { "phone": "919999999999", "event": "menu_tap", "data": "register" }
   Expected: event logged, PII written to stdout.
Pass: 401/403 returned without valid WACTO signature. Fail: records created.
```

---

### S12 🟠 — WhatsApp Webhook Skips HMAC If `META_APP_SECRET` Is Absent

**File:** `backend/routes/whatsappWebhook.js:40`

```js
if (process.env.META_APP_SECRET && !verifySignature(req)) {
```

The entire HMAC check is gated on the env var being present. If `META_APP_SECRET` is missing from the environment, **all incoming webhook payloads are accepted unconditionally**.

**Test prompt:**
```
Audit S12 — Webhook HMAC bypass
1. On a test server, start backend with META_APP_SECRET unset.
2. POST /api/whatsapp/webhook with a forged payload (any JSON body, no X-Hub-Signature-256).
   Expected: payload accepted, chatbot processes the fake message.
3. Confirm the live server has META_APP_SECRET set in .env (it does, per committed .env).
4. Verify the guard is inverted: change to `if (!verifySignature(req))` (always check).
Pass: HMAC check always runs regardless of env var. Fail: absent env var = open endpoint.
```

---

### S13 🟠 — No `npm test` Script; One Test File for One Service

**File:** `backend/package.json`

```json
"scripts": { "start": "node server.js", "dev": "node --watch server.js" }
```

There is no test script. The single test file (`boothVoterCounts.test.js`) covers only the jurisdiction service cache. Zero coverage of: OTP flow, auth middleware, admin login, route guards, area-scope enforcement, or any CRUD path.

**Test prompt:**
```
Audit S13 — Test coverage gap
1. Run: npm test
   Expected: command not found / exits with error (no test script).
2. Count files in backend/controllers/ (8 controllers, ~250 KB of logic).
3. Count test files: ls backend/tests/ → 1 file.
4. Run the one existing test: node --test backend/tests/boothVoterCounts.test.js
   Confirm it passes but covers 0 auth/security paths.
5. Identify the following untested paths:
   - verifyOtp (critical auth path)
   - protectAdmin (area-scope check)
   - adminLogin (credential validation)
   - register-schemes (unauthenticated write, see S5)
Pass: coverage tool reports >60% on controllers/. Fail: current state.
```

---

### S14 🟠 — Vulnerable Dependencies

**Test prompt:**
```
Audit S14 — Dependency vulnerabilities
1. cd backend && npm audit --json | jq '.vulnerabilities | to_entries[] | select(.value.severity=="high" or .value.severity=="critical") | {name:.key, severity:.value.severity, via:.value.via}'
2. cd frontend && npm audit --json | same filter
3. Confirm findings from July audit remain:
   - exceljs → archiver → brace-expansion DoS chain
   - react-router CSRF bypass (RSC mode)
   - uuid moderate
4. Run: npm audit fix --dry-run in both directories. Count auto-fixable vs. manual.
Pass: 0 HIGH or CRITICAL in npm audit. Fail: current reported count.
```

---

## MEDIUM

---

### S15 🟡 — `devOtp` Field Returned in Non-Production Responses

**File:** `backend/controllers/userChatController.js:65`

```js
...(process.env.NODE_ENV !== 'production' && { devOtp: otp })
```

Staging/dev environments return the live OTP in the JSON response body. If `NODE_ENV` is accidentally unset or set incorrectly on a staging server that is internet-reachable, OTPs are fully disclosed.

**Test prompt:**
```
Audit S15 — devOtp field exposure
1. Start backend with NODE_ENV=development (or unset).
2. POST /api/send-otp with {"mobile":"9999999999"}
   Expected: response body contains { "devOtp": "123456" }
3. Confirm the same endpoint on NODE_ENV=production omits devOtp.
4. Check if any public-facing staging URL exists (e.g. staging.tnbjp.org, vercel preview).
Pass: devOtp absent from all internet-reachable environments. Fail: present in staging.
```

---

### S16 🟡 — Dev Bypass OTP `123456` Active Outside Production

**File:** `backend/controllers/userChatController.js:99-101`

```js
const allowDevBypass = process.env.NODE_ENV !== 'production';
const isDevBypass = allowDevBypass && cleanOtp === '123456';
```

On any non-production environment (including a staging server), OTP `123456` bypasses real verification for any mobile number. Returns a valid JWT.

**Test prompt:**
```
Audit S16 — Dev bypass OTP on staging
1. POST /api/send-otp {"mobile":"9876543210"}
2. Immediately POST /api/verify-otp {"mobile":"9876543210","otp":"123456"}
   Expected (dev/staging): HTTP 200 with valid JWT. Expected (production): 400 OTP mismatch.
3. Confirm NODE_ENV is set to "production" on every internet-reachable server.
Pass: 123456 rejected on all public-facing environments. Fail: bypass active on staging.
```

---

### S17 🟡 — Referral Code Generated With `Math.random`

**File:** `backend/controllers/userChatController.js:360`

```js
const candidate = 'NT-' + Math.random().toString(36).substring(2, 10).toUpperCase();
```

Same issue as S7. `Math.random` state is predictable. Referral codes are also unique per user — if an attacker can predict the code space, they can probe for registered mobiles via `/api/referral-link/:ntCode`.

**Test prompt:**
```
Audit S17 — Predictable referral code generation
1. Register 20 users in rapid succession in dev.
2. Collect all referral codes from responses.
3. Verify they are generated sequentially from the same Math.random seed state.
4. Confirm the fix: crypto.randomBytes(6).toString('hex').toUpperCase() produces 
   48 bits of entropy vs. Math.random's ~32 effective bits.
Pass: crypto module used for referral code generation. Fail: Math.random in use.
```

---

### S18 🟡 — JWT Tokens in `localStorage` (XSS Exposed)

**File:** `frontend/src/context/AuthContext.jsx`, `frontend/src/pages/ChatbotPage.jsx:194`

Tokens stored in `localStorage` are accessible to any JavaScript running on the page. Combined with the CSP issue (S19), a single XSS vulnerability becomes a full account takeover.

**Test prompt:**
```
Audit S18 — Token storage in localStorage
1. Open browser devtools on tnbjp.org after login.
2. Run in console: localStorage.getItem('bjp_user_token'); localStorage.getItem('bjp_admin_token')
   Expected: full JWT returned.
3. Verify the token is a 7-day JWT with no binding to IP or device fingerprint.
4. Confirm no httpOnly cookie alternative is configured.
Pass: tokens stored in httpOnly, SameSite=Strict cookies. Fail: localStorage in use.
```

---

### S19 🟡 — CSP Allows `unsafe-inline` and `unsafe-eval`

**File:** `backend/bjptn_nginx.conf:15`

```
Content-Security-Policy: default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'; ...
```

`unsafe-inline` allows all inline scripts. `unsafe-eval` allows `eval()`. Together they make CSP ineffective as an XSS mitigation. Any injected script (e.g. via an SVG upload or a future template injection) runs unrestricted.

**Test prompt:**
```
Audit S19 — CSP effectiveness
1. curl -I https://tnbjp.org | grep -i content-security-policy
   Expected: observe unsafe-inline and unsafe-eval in the policy.
2. Open the page in browser, open Console, run: eval("alert('csp-bypass')")
   Expected: alert fires (unsafe-eval allows it).
3. Inject an inline script tag (requires a separate XSS vector) — confirm it executes.
4. Generate a compliant CSP: use https://csp-evaluator.withgoogle.com and paste the current value.
   Expected: "Unsafe CSP" rating.
Pass: nonce-based or hash-based CSP with no unsafe-inline. Fail: current policy.
```

---

### S20 🟡 — `POST /api/voter/confirm-registration` Has No Auth

**File:** `backend/routes/voterRoutes.js:6`

```js
router.post('/confirm-registration', confirmVoterRegistration);
```

No middleware guard. The handler marks a voter registration as confirmed for any supplied identifier.

**Test prompt:**
```
Audit S20 — Unauthenticated confirm-registration
1. POST /api/voter/confirm-registration with a crafted body (inspect voterController.js for expected fields).
   Expected: action succeeds without any JWT.
2. Verify the handler modifies DB state without caller authentication.
Pass: protectUser middleware applied. Fail: no auth required.
```

---

### S21 🟡 — `POST /api/validate-epic` Leaks Full PII to Unauthenticated Callers

**File:** `backend/routes/userChatRoutes.js:20`, `backend/controllers/userChatController.js:217-228`

Returns `voterName`, father/mother name, age, gender, district, assembly, booth, and serial number for **any EPIC** with no authentication. 5.68 crore voter records are enumerable by guessing EPIC formats (e.g. `TN/01/001/XXXXXX`).

**Test prompt:**
```
Audit S21 — Unauthenticated voter data enumeration
1. Without any token, POST /api/validate-epic {"epic_no": "TN01234567890"}
   Expected: voter name, gender, age, father/mother name returned (HTTP 200).
2. Write a loop iterating over sequential EPIC numbers for a known assembly.
   Expected: bulk voter PII extractable at the rate limited rate of 40/10min/IP (S10 amplified).
3. Confirm DPDP Act 2023 applicability: voter name + relationship name + age + booth = personal data.
Pass: endpoint requires valid JWT. Fail: unauthenticated access returns PII.
```

---

### S22 🟡 — `search-epic` Leaks Last-4 Digits of Registered Mobile

**File:** `backend/controllers/voterController.js`

The endpoint returns a message like "already registered under mobile ending in ...1234". This allows an attacker to correlate EPIC numbers with partial mobile numbers.

**Test prompt:**
```
Audit S22 — Mobile number partial disclosure
1. POST /api/voter/search-epic {"epic_no": "<registered EPIC>"}
   Expected: response includes "mobile ending in XXXX" or similar hint.
2. Confirm this allows building an EPIC → partial-mobile map without authentication.
Pass: response says only "registered: true/false" with no mobile hint. Fail: current behavior.
```

---

### S23 🟡 — Export Endpoint Loads Up to 500,000 Records Into Memory

**File:** `backend/controllers/adminController.js:686`

```js
const limitNum = isExport ? 500000 : Math.min(500, ...);
```

No streaming. All records are fetched into Node's heap, serialized to Excel/CSV in memory, then sent. On a 1 GB droplet with 4 PM2 workers, simultaneous export requests can OOM the server.

**Test prompt:**
```
Audit S23 — Export memory exhaustion
1. Monitor PM2 memory: pm2 monit
2. Trigger two simultaneous export requests from two admin sessions:
   GET /api/admin/export-excel (as state admin, no scope limit)
3. Observe Node.js heap usage spike.
   Expected: each export loads all matching records into RAM simultaneously.
4. Confirm there is no streaming (no res.write() / pipe) — it awaits the full query.
Pass: streaming cursor used (query.cursor() piped to response). Fail: current approach.
```

---

### S24 🟡 — ReDoS: Unescaped Regex From WACTO Input

**File:** `backend/controllers/bjpWactoController.js` (`findSchemeByName`)

Scheme name from WACTO message body is passed to `new RegExp(schemeName, 'i')` without escaping. A crafted string like `(a+)+$` causes catastrophic backtracking.

**Test prompt:**
```
Audit S24 — ReDoS via WACTO scheme name
1. POST /api/whatsapp/bjp-wacto/events (unauthenticated — see S11) with body:
   { "scheme_name": "(a+)+$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaac" }
2. Measure response time. Expected: request hangs / worker stalls for seconds.
3. Confirm escapeRegex() (present in adminController.js) is NOT applied in bjpWactoController.js.
Pass: input is escaped before RegExp construction. Fail: stall observed.
```

---

### S25 🟡 — Registration Trusts Browser-Supplied Geographic Data

**File:** `backend/controllers/userChatController.js:297-376`

`district`, `assemblyName`, `boothNo` in `register-schemes` come from `req.body` with no server-side cross-check against the voter DB. Anyone can register themselves under any booth in Tamil Nadu, inflating that booth's metrics.

**Test prompt:**
```
Audit S25 — Area spoofing in registration
1. Register with a valid EPIC but substitute district="CHENNAI", assemblyName="ROYAPURAM", boothNo="1"
   (use real voter's actual district to pass EPIC validation if any).
2. Check the resulting User document in MongoDB.
   Expected: user is created with CHENNAI/ROYAPURAM/1 regardless of voter DB address.
3. Observe the ROYAPURAM booth's dashboard showing an inflated member count.
Pass: server re-fetches voter DB record after EPIC validation and uses its address. Fail: browser values stored.
```

---

### S26 🟡 — OTP Session Not Deleted After Successful Verification

**File:** `backend/controllers/userChatController.js`

After a correct OTP, `session.verified = true` is set but the session document is not deleted. A `verified: true` session could be replayed against a future request if the lookup is not careful.

**Test prompt:**
```
Audit S26 — OTP session reuse after verification
1. Complete a valid OTP verification (get a JWT).
2. Immediately query OtpSession: db.otpsessions.findOne({mobile:"..."})
   Expected: document still exists with verified:true.
3. POST /api/verify-otp again with the same OTP.
   Expected: if findOne({verified:false}) is the query, this returns a different session.
   But confirm: is there any path where a verified session can be replayed?
4. Correct fix: deleteOne() the session on successful verification.
Pass: OtpSession document deleted on success. Fail: document persists.
```

---

### S27 🟡 — Race Condition: Duplicate User Registration Possible

**File:** `backend/controllers/userChatController.js`

User creation on `register-schemes` does not use an atomic upsert or a DB-level unique write guard beyond the Mongoose unique index. Concurrent requests for the same mobile can pass the `User.findOne()` check simultaneously and both attempt `User.create()`, causing a duplicate-key error that is swallowed.

**Test prompt:**
```
Audit S27 — Duplicate registration race condition
1. Send 10 concurrent POST /api/register-schemes requests for the same mobile.
   Use: for i in {1..10}; do curl -X POST /api/register-schemes -d '{"mobile":"9999999999",...}' & done; wait
2. Inspect MongoDB: db.users.countDocuments({mobile:"9999999999"})
   Expected (correct): 1 document. Observed risk: Mongoose throws E11000 on some workers.
3. Confirm there is no updateOne({mobile},{$setOnInsert:{...}},{upsert:true}) pattern.
Pass: atomic upsert used; exactly 1 document in all cases. Fail: race or unhandled E11000.
```

---

### S28 🟡 — Sentry DSN Hardcoded in `server.js`

**File:** `backend/server.js:10`

```js
dsn: 'https://3981855d15d59ffb24e8d77b8fcd97bb@o4512071928184832.ingest.de.sentry.io/4512071953219664',
```

Hardcoded DSN leaks Sentry project/org metadata. Anyone with the DSN can submit fake error events, flood your Sentry quota, or probe the project. Should come from `process.env.SENTRY_DSN`.

**Test prompt:**
```
Audit S28 — Hardcoded Sentry DSN
1. grep -rn "ingest" backend/server.js — confirm raw DSN in source.
2. Using the exposed DSN, POST a crafted event to the Sentry ingest endpoint.
   Expected: event appears in your Sentry project (quota consumed).
3. Confirm Sentry project is publicly enumerable via the org slug in the DSN.
Pass: DSN loaded from process.env.SENTRY_DSN. Fail: hardcoded in source.
```

---

## LOW

---

### S29–S35 — Low Severity Findings

**Test prompts for each:**

```
Audit S29 — waDiag.sh without chmod guard
1. ls -la backend/scripts/waDiag.sh
   Expected: permissions allow execution by any user on the server.
2. cat the file — confirm it sends live API requests.
Pass: script not committed or chmod 700 with owner=deploy. Fail: world-executable.

Audit S30 — Seeding scripts in production codebase
1. ls backend/scripts/ | grep -i seed
2. Confirm seedScreenshot1Data.js, seedSchemes.js etc. are importable by server.js require.
3. Verify no accidental import of seed scripts in server.js or any route.
Pass: seed scripts in a dedicated .gitignore'd directory. Fail: committed with production code.

Audit S31 — dist.tar.gz in git (34 MB)
1. git log --all --oneline -- frontend/dist.tar.gz
   Expected: committed to history, inflating clone size.
2. git count-objects -vH — verify large object overhead.
Pass: .gitignore excludes dist/ and dist.tar.gz. Fail: present in repo.

Audit S32 — Duplicate GeoJSON assets (1.4 MB × 2)
1. md5sum frontend/dist/tn-assemblies.geojson frontend/public/tn-assemblies.geojson
   Expected: identical files.
2. Verify total uncompressed size shipped: ~2.8 MB of duplicate geo data.
Pass: one canonical copy, build process references it. Fail: duplicate.

Audit S33 — No CI integrity check
1. grep -r "npm ci\|--frozen-lockfile" .github/ .claude/ — likely absent.
2. Confirm there is no CI pipeline (no .github/workflows/).
Pass: CI runs npm ci (not npm install) on every push. Fail: no pipeline / npm install used.

Audit S34 — Referral code collision retry without cap
1. Read userChatController.js:358: while loop for candidate generation with Math.random.
2. Confirm there is no maxAttempts guard.
3. Worst case: if collision space is exhausted, infinite loop hangs the worker.
Pass: loop has a max attempt count and throws if exceeded. Fail: unbounded while.

Audit S35 — Health endpoint exposes DB topology
1. curl https://tnbjp.org/api/health
   Expected: returns { databases: { app_db: "CONNECTED", voter_db: "CONNECTED" } }
2. Confirm this is unauthenticated and reveals internal database names and states.
Pass: health endpoint returns { status: "OK" } only, behind a secret header. Fail: current.
```

---

## What Is Working Well (Do Not Break)

The following controls are correctly implemented and should be preserved:

| Control | Location | Status |
|---|---|---|
| `bcrypt` (saltRounds=10) for admin passwords | `Admin.js` | ✅ Correct |
| `mongoSanitize` middleware | `server.js` | ✅ Correct |
| `escapeRegex()` helper in admin controller | `adminController.js:17` | ✅ Correct — extend to S24 |
| Helmet security headers | `server.js` | ✅ Correct |
| CORS allowlist (not wildcard) | `server.js` | ✅ Correct |
| WhatsApp webhook HMAC check (when env var set) | `whatsappWebhook.js:21-40` | ✅ Correct — fix S12 guard |
| WhatsApp Flow RSA-OAEP + AES-128-GCM | `whatsappFlow.js` | ✅ Correct |
| Token version revocation for DB admins | `authMiddleware.js`, `Admin.js` | ✅ Correct — extend to S6 |
| `devOtp` gated to non-production | `userChatController.js:65` | ✅ Correct — but fix S15 |
| JWT_SECRET weak-value guard + process.exit | `server.js:35` | ✅ Correct |
| `trust proxy 1` behind nginx | `server.js` | ✅ Correct |
| HTTPS enforced + HSTS preload | `bjptn_nginx.conf` | ✅ Correct |
| OTP 5-attempt lockout + per-mobile 60s cooldown | `userChatController.js` | ✅ Correct |

---

## Test Execution Checklist

Copy this to your issue tracker. Run in order — later tests depend on earlier ones passing.

```
[ ] S1  — Confirm .env is not in git history; rotate all secrets
[ ] S2  — Formula password removed; dynamic admins use real DB records
[ ] S3  — Booth voter-roll endpoint enforces admin's own scope
[ ] S4  — List/export endpoints AND scope to admin's area
[ ] S5  — /api/register-schemes requires valid JWT (protectUser)
[ ] S6  — DYNAMIC_ tokens check tokenVersion against a DB record
[ ] S7  — OTP uses crypto.randomInt()
[ ] S8  — OTP stored as bcrypt hash; compare hash in verifyOtp
[ ] S9  — Mobile number not logged; log only last-4 or a hash
[ ] S10 — Rate limiter uses shared MongoDB TTL store or Redis
[ ] S11 — BJP-Wacto endpoints require WACTO HMAC or internal-only binding
[ ] S12 — HMAC check runs unconditionally (remove env-var guard)
[ ] S13 — npm test script added; auth middleware and OTP flow covered
[ ] S14 — npm audit shows 0 HIGH/CRITICAL
[ ] S15 — devOtp absent from staging responses
[ ] S16 — 123456 bypass absent from all internet-facing environments
[ ] S17 — Referral code uses crypto.randomBytes()
[ ] S18 — Tokens moved to httpOnly, SameSite=Strict cookies
[ ] S19 — CSP uses nonce or hash; unsafe-inline/unsafe-eval removed
[ ] S20 — /api/voter/confirm-registration requires protectUser
[ ] S21 — /api/validate-epic requires valid JWT
[ ] S22 — search-epic response omits mobile hint
[ ] S23 — Export uses streaming cursor; memory cap enforced
[ ] S24 — findSchemeByName escapes input before RegExp
[ ] S25 — Registration re-validates address from voter DB
[ ] S26 — OTP session deleted (not just marked verified) on success
[ ] S27 — User creation uses atomic findOneAndUpdate upsert
[ ] S28 — SENTRY_DSN loaded from environment variable
[ ] S29 — waDiag.sh permissions tightened
[ ] S30 — Seed scripts gitignored or moved out of production path
[ ] S31 — dist/ and dist.tar.gz gitignored
[ ] S32 — Duplicate GeoJSON consolidated
[ ] S33 — CI pipeline runs npm ci --frozen-lockfile
[ ] S34 — Referral code loop has maxAttempts guard
[ ] S35 — Health endpoint behind auth header or returns minimal info
```

---

*Audit conducted: 2026-10-14 | Analyst: SE III read-only static analysis | Next audit recommended after S1–S6 resolved*
