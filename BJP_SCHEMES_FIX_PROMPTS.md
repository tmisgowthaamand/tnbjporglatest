# BJP Nalam Thittam — Fix Prompts for All 30 Open Findings
**Reference:** `LOCAL_SECURITY_AUDIT_REPORT.md` (30 failed, 5 passed)  
**Order:** Fix Criticals first (S2→S6→S3→S4), then High, then Medium, then Low.  
**How to use:** Copy each prompt block to Claude/Cursor/Copilot with the file open.

---

## 🔴 CRITICAL FIXES (Do these first — in order)

---

### FIX S2 — Remove Formula Passwords, Migrate to DB Admins

**File:** `backend/services/jurisdictionService.js`  
**Problem:** Passwords are `60227000 + assemblyNo` — fully guessable.

**Prompt to give Claude/Cursor:**
```
In backend/services/jurisdictionService.js, the function authenticateDynamicAdmin() 
computes passwords with arithmetic formulas:
  District:  60228001 + idx
  Assembly:  60227000 + assemblyNo
  Booth:     60227680 + boothNo

This is a CRITICAL security vulnerability. Do the following:

1. DELETE the entire authenticateDynamicAdmin() function body — return null always 
   (or remove the function entirely).

2. In getDistrictCredentialsList(), getAssemblyCredentialsList(), 
   getBoothCredentialsForAssembly() — REMOVE the `passcode` and `username` fields 
   from the returned objects. These credential lists should only be visible to 
   SUPER_ADMIN and are used for display, not auth.

3. In backend/controllers/adminController.js in the adminLogin function, 
   REMOVE the block that calls authenticateDynamicAdmin(). 
   Login should only succeed against real Admin documents in MongoDB.

4. Write a one-time migration script at backend/scripts/migrateToDbAdmins.js that:
   - Reads the assembly + district list from jurisdictionService.getAssemblyMetadata()
   - For each assembly: creates an Admin document with role=ASSEMBLY_ADMIN, 
     username=<slug>_admin, a crypto.randomBytes(8).toString('hex') password,
     district and assemblyName set correctly
   - For each district: creates Admin with role=DISTRICT_ADMIN
   - Saves all credentials to a JSON file (not stdout) so the team can distribute them
   - Skips if username already exists in Admin collection
   - Uses Admin.create() so bcrypt pre-save hook hashes the password

5. After migration, ensure authMiddleware.js protectAdmin() NEVER allows 
   DYNAMIC_ prefixed _id values to bypass the DB lookup.
```

---

### FIX S6 — Make DYNAMIC_ Tokens Revocable

**File:** `backend/middleware/authMiddleware.js`  
**Problem:** Lines 40–50 skip tokenVersion check for DYNAMIC_ tokens — they can never be revoked.

**Prompt:**
```
In backend/middleware/authMiddleware.js, the protectAdmin function has this block:

  if (String(decoded.id).startsWith('DYNAMIC_')) {
    req.admin = { _id: decoded.id, username: decoded.username, ... };
    // NO tokenVersion check here
  } else {
    req.admin = await Admin.findById(decoded.id).select('-password');
  }

After completing FIX S2 (no more dynamic logins), remove the entire 
DYNAMIC_ branch. All admins must now be found in the Admin MongoDB collection.

The fixed protectAdmin should be:
  1. Decode the JWT
  2. If decoded.isAdmin is false → 403
  3. req.admin = await Admin.findById(decoded.id).select('-password')
  4. If !req.admin → 401 (admin deleted)
  5. If decoded.tokenVersion !== req.admin.tokenVersion → 401 (session revoked)
  6. next()

Remove all DYNAMIC_ special-casing. Every admin must exist in the DB.
This means FIX S2's migration script must run BEFORE this change is deployed.
```

---

### FIX S3 — Enforce Admin's Own Scope on Booth Voter Roll

**File:** `backend/controllers/adminController.js` — `getBoothVoterRoll` function (~line 1640)  
**Problem:** `targetBooth = queryBoothNo || admin.boothNo` — caller overrides scope.

**Prompt:**
```
In backend/controllers/adminController.js, find the getBoothVoterRoll function.

Currently:
  const targetBooth = queryBoothNo || admin.boothNo;
  const targetAssembly = queryAssemblyName || admin.assemblyName;

This lets any admin pass any boothNo/assemblyName and read that booth's voter roll.

Fix: enforce the admin's own jurisdiction boundaries:

  // SUPER_ADMIN and STATE_ADMIN: may query any booth (pass-through)
  // DISTRICT_ADMIN: may only query booths within their district
  // ASSEMBLY_ADMIN: may only query booths within their assembly
  // BOOTH_ADMIN: may only query their own booth

  const role = admin.role;

  // Resolve requested scope
  const requestedAssembly = queryAssemblyName || admin.assemblyName;
  const requestedBooth    = queryBoothNo     || admin.boothNo;

  // Enforce scope boundaries
  if (role === 'BOOTH_ADMIN') {
    // Must match their exact assembly and booth
    if (
      requestedAssembly?.toUpperCase() !== admin.assemblyName?.toUpperCase() ||
      String(requestedBooth) !== String(admin.boothNo)
    ) {
      return res.status(403).json({ success: false, message: 'Forbidden: You can only view your own booth.' });
    }
  } else if (role === 'ASSEMBLY_ADMIN') {
    // May query any booth within their assembly only
    if (requestedAssembly?.toUpperCase() !== admin.assemblyName?.toUpperCase()) {
      return res.status(403).json({ success: false, message: 'Forbidden: You can only view booths in your assembly.' });
    }
  } else if (role === 'DISTRICT_ADMIN') {
    // Verify the requested assembly belongs to their district
    const assemblies = await getAssemblyMetadata();
    const found = assemblies.find(a => a.assemblyName.toUpperCase() === requestedAssembly?.toUpperCase());
    if (!found || found.district.toUpperCase() !== admin.district?.toUpperCase()) {
      return res.status(403).json({ success: false, message: 'Forbidden: Assembly is not in your district.' });
    }
  }
  // SUPER_ADMIN / STATE_ADMIN: no restriction

  const targetBooth    = requestedBooth;
  const targetAssembly = requestedAssembly;

Apply this scope check BEFORE any DB query in the function.
```

---

### FIX S4 — AND Scope Filter Instead of Overwriting It

**Files:** `backend/controllers/adminController.js`  
**Functions:** `getApplicationsList` (~line 683), `exportApplicationsCsv` (~line 1213), `exportApplicationsExcel` (~line 1321)  
**Problem:** `appScopeFilter.district = req.query.district` overwrites the admin's own district.

**Prompt:**
```
In backend/controllers/adminController.js there are three functions:
getApplicationsList, exportApplicationsCsv, exportApplicationsExcel.

All three do this pattern (example from getApplicationsList):
  const appScopeFilter = { ...getAdminScopeQuery(admin) };  // admin's own scope
  if (isValidFilterVal(district)) appScopeFilter.district = new RegExp(...);  // ← OVERWRITES

This lets a BOOTH_ADMIN pass ?district=CHENNAI and read Chennai's data.

Fix: the query param must NARROW (AND) the existing admin scope, never widen it.

Helper function to add near the top of the file (after getAdminScopeQuery):

  /**
   * Applies a filter value only if it does not widen beyond the admin's own scope.
   * For string fields: the requested value must match or be a subset of the admin's value.
   * Returns false if the request tries to widen scope (caller should return 403).
   */
  const applyNarrowingFilter = (scopeFilter, field, requestedValue, adminValue) => {
    if (!requestedValue) return true; // no filter requested — keep existing scope
    // If admin already has a fixed value for this field, the request must match it
    if (adminValue && requestedValue.toUpperCase() !== adminValue.toUpperCase()) {
      return false; // attempted to widen scope
    }
    scopeFilter[field] = new RegExp('^' + escapeRegex(requestedValue.trim()) + '$', 'i');
    return true;
  };

Then replace the three overwrite blocks in each function:

  // OLD (INSECURE):
  if (isValidFilterVal(district))     appScopeFilter.district     = new RegExp(...);
  if (isValidFilterVal(assemblyName)) appScopeFilter.assemblyName = new RegExp(...);
  if (isValidFilterVal(boothNo))      appScopeFilter.boothNo      = String(boothNo).trim();

  // NEW (SECURE):
  if (isValidFilterVal(district)) {
    const ok = applyNarrowingFilter(appScopeFilter, 'district', toDbDistrict(district), admin.district);
    if (!ok) return res.status(403).json({ success: false, message: 'Forbidden: Cannot filter outside your district.' });
  }
  if (isValidFilterVal(assemblyName)) {
    const ok = applyNarrowingFilter(appScopeFilter, 'assemblyName', assemblyName, admin.assemblyName);
    if (!ok) return res.status(403).json({ success: false, message: 'Forbidden: Cannot filter outside your assembly.' });
  }
  if (isValidFilterVal(boothNo)) {
    if (admin.boothNo && String(boothNo).trim() !== String(admin.boothNo)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Cannot filter outside your booth.' });
    }
    appScopeFilter.boothNo = String(boothNo).trim();
  }

Apply this exact pattern to all three functions.
SUPER_ADMIN and STATE_ADMIN have no admin.district/assemblyName/boothNo set,
so applyNarrowingFilter always returns true for them — no restriction.
```

---

## 🟠 HIGH FIXES

---

### FIX S7 — Replace Math.random OTP with crypto.randomInt

**File:** `backend/controllers/userChatController.js:26`

**Prompt:**
```
In backend/controllers/userChatController.js, find the sendOtp function.

Change:
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

To:
  const crypto = require('crypto');  // add at top of file if not already there
  const otp = crypto.randomInt(100000, 1000000).toString();

crypto.randomInt is cryptographically secure (uses OS CSPRNG).
Math.random's V8 state is recoverable from ~20 samples.
```

---

### FIX S8 — Hash OTP Before Storing in MongoDB

**Files:** `backend/controllers/userChatController.js`, `backend/models/OtpSession.js`

**Prompt:**
```
In backend/controllers/userChatController.js, OTP is stored as plain text:
  await OtpSession.create({ mobile: cleanMobile, otp, ... });

And verified as:
  const session = await OtpSession.findOne({ mobile: cleanMobile, verified: false });
  if (session.otp !== cleanOtp) { ... }

Fix:

1. In sendOtp(): hash the OTP before saving:
   const bcrypt = require('bcryptjs');  // already in package.json
   const otpHash = await bcrypt.hash(otp, 8);
   await OtpSession.create({ mobile: cleanMobile, otp: otpHash, ... });
   // Still send the raw otp via SMS and devOtp (raw value, not hash)

2. In verifyOtp(): compare using bcrypt:
   // Replace: if (session.otp !== cleanOtp)
   // With:
   const isOtpValid = await bcrypt.compare(cleanOtp, session.otp);
   if (!isOtpValid) { ... }

3. Also update the dev bypass check — it compares cleanOtp === '123456' directly,
   which is fine since that's before the session lookup.

Cost factor 8 is sufficient for a 6-digit OTP (fast to verify, minimal server load).
```

---

### FIX S9 — Mask Mobile Number in Logs

**File:** `backend/controllers/userChatController.js:345`

**Prompt:**
```
In backend/controllers/userChatController.js, find:
  console.log('[registerSchemes] mobile=%s referredBy=%s', cleanMobile, incomingRef || '(none)');

Replace with:
  const maskMobile = (m) => m ? m.slice(0, 2) + '****' + m.slice(-2) : '(none)';
  console.log('[registerSchemes] mobile=%s referredBy=%s', maskMobile(cleanMobile), incomingRef ? 'set' : '(none)');

Also search the entire userChatController.js for any other console.log that 
prints cleanMobile or mobile directly and apply the same maskMobile helper.
Move maskMobile to a shared backend/utils/logHelpers.js so all controllers can use it.
```

---

### FIX S10 — Shared Rate Limit Store Across PM2 Workers

**File:** `backend/server.js`

**Prompt:**
```
In backend/server.js, all rate limiters use express-rate-limit with no store option,
meaning each PM2 worker has its own counter. With 4 workers the real limit is 4× configured.

Fix: use rate-limit-mongo for a shared MongoDB-backed store.

1. Install: npm install rate-limit-mongo

2. At the top of server.js, add:
   const MongoStore = require('rate-limit-mongo');

3. Create a shared store factory:
   const makeMongoStore = (collectionName) => new MongoStore({
     uri: process.env.MONGO_APP_URL + '/bjp_app',
     collectionName,
     expireTimeMs: 15 * 60 * 1000  // longest window used
   });

4. Update each rateLimit() call to include the store:
   const otpLimiter = rateLimit({
     windowMs: 10 * 60 * 1000,
     max: 6,
     store: makeMongoStore('rl_otp'),
     ...
   });
   
   const loginLimiter = rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 15,
     store: makeMongoStore('rl_login'),
     ...
   });

   Do the same for verifyLimiter, epicLimiter, checkMobileLimiter.

5. MongoDB TTL will auto-clean old rate-limit documents.
   No extra collection maintenance needed.
```

---

### FIX S12 — Always Verify WhatsApp Webhook HMAC

**File:** `backend/routes/whatsappWebhook.js:40`

**Prompt:**
```
In backend/routes/whatsappWebhook.js, find:
  if (process.env.META_APP_SECRET && !verifySignature(req)) {

The outer condition means: if META_APP_SECRET is not set, skip HMAC entirely.
This allows forged webhooks when the env var is missing.

Fix — change the guard to always verify:
  if (!verifySignature(req)) {
    console.warn('[wa-webhook] invalid or missing signature — rejecting');
    return res.sendStatus(403);
  }

Also update verifySignature() to return false (not throw) when META_APP_SECRET is unset:
  function verifySignature(req) {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
      console.error('[wa-webhook] META_APP_SECRET not set — rejecting all webhooks');
      return false;  // fail closed, not open
    }
    const signature = req.headers['x-hub-signature-256'];
    if (!signature || !req.rawBody) return false;
    const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(req.rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }
```

---

### FIX S13 — Add npm test Script and Auth Test Suite

**Files:** `backend/package.json`, new `backend/tests/auth.test.js`

**Prompt:**
```
1. In backend/package.json, add to scripts:
   "test": "node --test tests/**/*.test.js",
   "test:watch": "node --test --watch tests/**/*.test.js"

2. Create backend/tests/auth.test.js using Node's built-in test runner (no extra deps):

const test = require('node:test');
const assert = require('node:assert');

// Mock dependencies before requiring controllers
// Test cases to implement:

test('verifyOtp - rejects expired session', async (t) => { ... });
test('verifyOtp - rejects wrong OTP and increments attempts', async (t) => { ... });
test('verifyOtp - locks out after 5 wrong attempts', async (t) => { ... });
test('verifyOtp - 123456 bypass only works in non-production', async (t) => { ... });
test('protectAdmin - rejects missing token', async (t) => { ... });
test('protectAdmin - rejects DYNAMIC_ token after S6 fix', async (t) => { ... });
test('protectAdmin - rejects mismatched tokenVersion', async (t) => { ... });
test('getBoothVoterRoll - BOOTH_ADMIN cannot access other booth (S3 fix)', async (t) => { ... });
test('getApplicationsList - DISTRICT_ADMIN cannot widen to other district (S4 fix)', async (t) => { ... });

3. Create backend/tests/otp.test.js:
test('sendOtp - OTP is 6 digits', async (t) => { ... });
test('sendOtp - OTP is stored as bcrypt hash after S8 fix', async (t) => { ... });
test('sendOtp - respects 60s per-mobile cooldown', async (t) => { ... });
```

---

### FIX S14 — Fix Vulnerable Dependencies

**Prompt:**
```
Run the following in both backend/ and frontend/:

1. cd backend && npm audit --json > /tmp/audit_backend.json
   cd frontend && npm audit --json > /tmp/audit_frontend.json

2. For auto-fixable issues:
   cd backend && npm audit fix
   cd frontend && npm audit fix

3. For exceljs (the main HIGH chain in backend):
   npm install exceljs@latest

4. Check for remaining HIGH/CRITICAL after fix:
   npm audit --audit-level=high

5. If react-router has a CSRF advisory in frontend:
   npm install react-router@latest

6. Commit the updated package-lock.json files.
   Never commit node_modules/.
```

---

## 🟡 MEDIUM FIXES

---

### FIX S15 + S16 — Remove devOtp Field and 123456 Bypass

**File:** `backend/controllers/userChatController.js`

**Prompt:**
```
In backend/controllers/userChatController.js:

1. REMOVE the devOtp field from the sendOtp response entirely (not just gate it):
   // REMOVE this line:
   ...(process.env.NODE_ENV !== 'production' && { devOtp: otp })
   The OTP reaches the developer via SMS in all envs. The devOtp response 
   field is a PII leak risk if NODE_ENV is misconfigured.

2. REMOVE the 123456 dev bypass from verifyOtp:
   // REMOVE these lines:
   const allowDevBypass = process.env.NODE_ENV !== 'production';
   const isDevBypass = allowDevBypass && cleanOtp === '123456';
   // And all references to isDevBypass throughout the function.
   
   For local dev: use the actual OTP returned in the SMS (use a real number),
   or add a dev-only route GET /api/dev/last-otp that reads the DB directly
   (protected by checking NODE_ENV === 'development' at the start).
```

---

### FIX S17 — Use crypto for Referral Code Generation

**File:** `backend/controllers/userChatController.js:360`

**Prompt:**
```
In backend/controllers/userChatController.js, find the referral code generation loop:
  const candidate = 'NT-' + Math.random().toString(36).substring(2, 10).toUpperCase();

Replace with:
  const crypto = require('crypto');
  const candidate = 'NT-' + crypto.randomBytes(4).toString('hex').toUpperCase();

Also add a maxAttempts guard to the retry loop (if not already done — S34 was fixed):
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = 'NT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const existing = await User.findOne({ referralCode: candidate });
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate unique referral code after 10 attempts');
```

---

### FIX S18 — Move JWT Tokens from localStorage to httpOnly Cookies

**Files:** `frontend/src/context/AuthContext.jsx`, `frontend/src/pages/ChatbotPage.jsx`, `backend/server.js`, `backend/middleware/authMiddleware.js`

**Prompt:**
```
Currently JWT tokens are stored in localStorage, making them stealable via XSS.
Fix: use httpOnly, SameSite=Strict cookies instead.

BACKEND changes:

1. Install: npm install cookie-parser
2. In server.js: 
   const cookieParser = require('cookie-parser');
   app.use(cookieParser());

3. In adminLogin response (adminController.js), instead of returning token in JSON:
   res.cookie('bjp_admin_token', token, {
     httpOnly: true,
     secure: process.env.NODE_ENV === 'production',
     sameSite: 'Strict',
     maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
   });
   // Remove token from JSON response body

4. In authMiddleware.js protectAdmin and protectUser:
   // Also check cookies if Authorization header is absent:
   const token = (req.headers.authorization?.split(' ')[1]) 
              || req.cookies?.bjp_admin_token 
              || req.cookies?.bjp_user_token;

5. Add a logout endpoint that clears the cookie:
   res.clearCookie('bjp_admin_token');
   res.clearCookie('bjp_user_token');

FRONTEND changes:

6. In AuthContext.jsx: remove all localStorage.setItem/getItem for tokens.
7. In ChatbotPage.jsx: remove localStorage token handling.
8. API calls now send credentials automatically via cookies — add to axios:
   const API = axios.create({ baseURL: ..., withCredentials: true });
   Remove the Authorization header interceptor (cookies are sent automatically).
```

---

### FIX S19 — Tighten Content Security Policy

**File:** `bjptn_nginx.conf:15`

**Prompt:**
```
In bjptn_nginx.conf, the current CSP is:
  "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'; ..."

unsafe-inline and unsafe-eval make CSP useless against XSS.

Replace with a strict nonce-based CSP. Since nginx cannot generate per-request nonces 
without Lua, use a hash-based approach for the few inline scripts, or move all 
inline scripts to external files first.

Interim fix (removes unsafe-eval immediately, keeps unsafe-inline until scripts are moved):
  add_header Content-Security-Policy "
    default-src 'self';
    script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com;
    img-src 'self' https: data: blob: *.cloudinary.com res.cloudinary.com;
    connect-src 'self' https://tnbjp.org https://o4512071928184832.ingest.de.sentry.io;
    frame-ancestors 'self';
  " always;

Full fix (after moving all inline scripts to .js files):
  script-src 'self' https://cdn.jsdelivr.net;
  (remove unsafe-inline entirely)
```

---

### FIX S20 — Protect confirm-registration Route

**File:** `backend/routes/voterRoutes.js:6`

**Prompt:**
```
In backend/routes/voterRoutes.js:
  router.post('/confirm-registration', confirmVoterRegistration);

Add auth middleware:
  const { protectUser } = require('../middleware/authMiddleware');
  router.post('/confirm-registration', protectUser, confirmVoterRegistration);

Then in voterController.js confirmVoterRegistration:
  Verify req.user exists (middleware already does this).
  Only allow the user to confirm their own registration (match req.user.mobile).
```

---

### FIX S21 — Require Auth on validate-epic Endpoint

**File:** `backend/routes/userChatRoutes.js:20`

**Prompt:**
```
In backend/routes/userChatRoutes.js:
  router.post('/validate-epic', validateEpic);

This returns full PII (name, father/mother name, age, gender, booth) to anyone.
The endpoint is needed during registration — but only after OTP verification.

Fix option A (simplest): require a valid user token:
  router.post('/validate-epic', protectUser, validateEpic);

Fix option B (registration flow): require a verified-but-not-yet-registered session.
  Create a lightweight middleware checkOtpVerified that:
  - Accepts a short-lived signed token issued after OTP success (not a full user JWT)
  - Or accepts a valid user JWT (for re-validation flows)
  router.post('/validate-epic', checkOtpVerified, validateEpic);

Also reduce the data returned by validateEpic:
  // Only return what the registration confirm screen actually needs:
  return res.json({
    success: true,
    voterName: voter.NAME,
    district: voter.DISTRICT,
    assemblyName: voter.ASSEMBLY_NAME,
    boothNo: voter.PART_NO,
    // Remove: relationName, age, gender, serialNo
  });
```

---

### FIX S22 — Remove Mobile Hint from search-epic Response

**File:** `backend/controllers/voterController.js`

**Prompt:**
```
In backend/controllers/voterController.js, find the searchEpic function.
It returns a message like: "already registered under mobile ending in XXXX"

Replace the response with:
  return res.status(200).json({
    success: true,
    registered: true
    // Remove: any mention of mobile digits
  });

The caller only needs to know if it's registered — not which phone.
```

---

### FIX S23 — Stream Export Instead of Loading 500k Rows Into Memory

**File:** `backend/controllers/adminController.js` — `exportApplicationsExcel` (~line 1321)

**Prompt:**
```
In exportApplicationsExcel, the current code:
  const limitNum = isExport ? 500000 : Math.min(500, ...);
  const applications = await SchemeApplication.find(appScopeFilter).limit(limitNum).lean();
  // then builds full Excel workbook in memory

This loads up to 500,000 documents into Node heap simultaneously.

Note: exportApplicationsCsv already uses a streaming cursor correctly — replicate that pattern.

Fix exportApplicationsExcel to stream:

1. Set a hard cap on exports: max 50,000 rows per export request.
   const EXPORT_HARD_CAP = 50000;

2. Use a Mongoose cursor instead of .lean():
   const cursor = SchemeApplication.find(appScopeFilter)
     .sort({ appliedAt: -1 })
     .limit(EXPORT_HARD_CAP)
     .cursor();

3. Use exceljs streaming writer:
   const { Workbook } = require('exceljs');
   const workbook = new Workbook();
   const sheet = workbook.addWorksheet('Applications');
   // Add header row
   sheet.addRow([...headers]);
   
   // Stream rows from cursor
   for await (const doc of cursor) {
     sheet.addRow([...values]);
   }
   
   // Stream to response
   res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   await workbook.xlsx.write(res);
   res.end();

4. Remove the limitNum = 500000 line entirely.
```

---

### FIX S25 — Validate District/Assembly from Voter DB on Registration

**File:** `backend/controllers/userChatController.js` — `registerSchemes` function (~line 297)

**Prompt:**
```
In backend/controllers/userChatController.js in registerSchemes():

Currently the code takes district, assemblyName, boothNo from req.body and stores them 
directly. A user can register themselves under any booth in Tamil Nadu.

Fix: if an EPIC is provided, use the voter DB record's address — not the browser's:

  const { mobile, epic_no, voter_name, referredBy, district, assemblyName, boothNo } = req.body;
  
  let finalDistrict = district;
  let finalAssembly = assemblyName;
  let finalBooth = boothNo;
  let finalName = voter_name;

  // If EPIC is real (not pending), re-fetch from voter DB to authoritative values
  if (epic_no && !epic_no.startsWith('PND-')) {
    try {
      const voter = await findVoterByEpic(epic_no.toUpperCase().trim());
      if (voter) {
        finalName     = voter.NAME || voter_name;
        finalDistrict = voter.DISTRICT || district;
        finalAssembly = voter.ASSEMBLY_NAME || assemblyName;
        finalBooth    = String(voter.PART_NO || boothNo);
      }
    } catch (err) {
      console.warn('[registerSchemes] voter DB lookup failed, using submitted values:', err.message);
    }
  }

  // Use finalDistrict, finalAssembly, finalBooth, finalName for User.create()
  // Never store the raw browser values when a voter DB record exists.
```

---

### FIX S26 — Delete OTP Session After Successful Verification

**File:** `backend/controllers/userChatController.js:125`

**Prompt:**
```
In backend/controllers/userChatController.js, in verifyOtp(), find:
  session.verified = true;
  await session.save();

Replace with:
  await session.deleteOne();

Reason: leaving a verified session in the DB (even marked verified) is unnecessary state.
The verified session cannot be replayed because findOne({verified:false}) won't find it,
but deleting it is cleaner, prevents edge-case replay if that query ever changes,
and keeps the otpsessions collection small.
```

---

### FIX S27 — Atomic User Creation to Prevent Race Condition

**File:** `backend/controllers/userChatController.js` — `registerSchemes`

**Prompt:**
```
In backend/controllers/userChatController.js in registerSchemes(),
the current pattern is:
  const existingUser = await User.findOne({ mobile: cleanMobile });
  if (!existingUser) {
    const newUser = await User.create({ mobile: cleanMobile, ... });
  }

Under concurrent requests for the same mobile, two requests can both pass 
the findOne check and both try User.create(), causing a duplicate-key E11000 error.

Fix: use an atomic upsert:
  const newUser = await User.findOneAndUpdate(
    { mobile: cleanMobile },                      // filter
    { $setOnInsert: {                             // only set on INSERT, not update
        mobile: cleanMobile,
        epicNo: finalEpic,
        voterName: finalName,
        district: finalDistrict,
        assemblyName: finalAssembly,
        boothNo: finalBooth,
        gender: gender || 'Unspecified',
        referralCode: generatedReferralCode,
        referredBy: resolvedReferrer,
        tokenVersion: 1,
        createdAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // newUser is the existing or newly created document — no race condition possible.
```

---

### FIX S28 — Load Sentry DSN from Environment Variable

**File:** `backend/server.js:10`

**Prompt:**
```
In backend/server.js, find:
  Sentry.init({
    dsn: 'https://3981855d15d59ffb24e8d77b8fcd97bb@o4512071928184832.ingest.de.sentry.io/...',
    ...
  });

Replace with:
  Sentry.init({
    dsn: process.env.SENTRY_DSN,   // undefined = Sentry disabled (safe default)
    ...
  });

Add to backend/.env (and .env.example):
  SENTRY_DSN=https://3981855d15d59ffb24e8d77b8fcd97bb@o4512071928184832.ingest.de.sentry.io/4512071953219664

Add to .env.example (placeholder only):
  SENTRY_DSN=

When SENTRY_DSN is not set, Sentry silently disables itself — no crash, no error.
```

---

## 🔵 LOW FIXES

---

### FIX S29 — Remove or Restrict waDiag.sh

**Prompt:**
```
backend/scripts/waDiag.sh makes live API calls and should not be executable by all users.
Either:
  chmod 700 backend/scripts/waDiag.sh
Or add it to .gitignore and remove from repo:
  echo "backend/scripts/waDiag.sh" >> .gitignore
  git rm --cached backend/scripts/waDiag.sh
```

---

### FIX S30 — Gitignore Seed Scripts

**Prompt:**
```
Seed scripts (seedSchemes.js, seedScreenshot1Data.js, etc.) should not be in 
the main backend/ directory alongside production code.

Move them:
  mkdir backend/scripts/seeds
  mv backend/scripts/seed*.js backend/scripts/seeds/
  mv backend/seed-test-data.js backend/scripts/seeds/

Add to .gitignore if these should not be tracked:
  backend/scripts/seeds/

Or keep tracked but add a guard in each seed file:
  if (process.env.NODE_ENV === 'production') {
    console.error('Seed scripts cannot run in production');
    process.exit(1);
  }
```

---

### FIX S31 — Remove dist.tar.gz from Git

**Prompt:**
```
frontend/dist.tar.gz (34 MB) is committed and inflates the repo clone size.

Remove it:
  git rm frontend/dist.tar.gz
  echo "frontend/dist.tar.gz" >> .gitignore
  echo "frontend/dist/" >> .gitignore
  git commit -m "chore: remove built dist from repo"

Built assets belong in CI output, not in source control.
Your Vercel/DigitalOcean deployment should build from source.
```

---

### FIX S32 — Deduplicate GeoJSON Assets

**Prompt:**
```
frontend/public/tn-assemblies.geojson and frontend/dist/tn-assemblies.geojson 
are identical files (1.4 MB each = 2.8 MB total).

Fix:
1. Keep only frontend/public/tn-assemblies.geojson (Vite copies public/ to dist/ on build).
2. Delete frontend/dist/tn-assemblies.geojson manually.
3. Add frontend/dist/ to .gitignore so it's never committed again.

Same for tn-districts.geojson and all other duplicated assets.
```

---

### FIX S33 — Add CI Pipeline with Lockfile Enforcement

**Prompt:**
```
Create .github/workflows/ci.yml:

name: CI
on: [push, pull_request]
jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: backend/package-lock.json }
      - run: cd backend && npm ci          # enforces lockfile — fails if lock is out of sync
      - run: cd backend && npm audit --audit-level=high
      - run: cd backend && npm test

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm', cache-dependency-path: frontend/package-lock.json }
      - run: cd frontend && npm ci
      - run: cd frontend && npm audit --audit-level=high
      - run: cd frontend && npm run build
```

---

### FIX S35 — Restrict /api/health Response

**File:** `backend/server.js` — `app.get('/api/health', ...)`

**Prompt:**
```
In backend/server.js, the /api/health endpoint returns:
  { databases: { app_db: "CONNECTED", voter_db: "CONNECTED" } }

This exposes internal DB topology to unauthenticated callers.

Fix option A — minimal public response:
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'OK' : 'DEGRADED',
    timestamp: new Date().toISOString()
    // Remove: databases object, internal db names, connection states
  });

Fix option B — full detail behind a secret header (for monitoring tools):
  const monitoringKey = req.headers['x-monitoring-key'];
  const isInternal = monitoringKey === process.env.HEALTH_CHECK_KEY;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'OK' : 'DEGRADED',
    ...(isInternal && { databases: { app_db: ..., voter_db: ... } })
  });
```

---

## 📋 Fix Order Checklist

```
CRITICAL — Fix these in one sitting, deploy together:
[ ] S2  → Run migrateToDbAdmins.js script first, then remove authenticateDynamicAdmin
[ ] S6  → Remove DYNAMIC_ branch from authMiddleware (after S2 migration done)
[ ] S3  → Add scope enforcement to getBoothVoterRoll
[ ] S4  → Replace scope overwrite with applyNarrowingFilter in 3 functions

HIGH — Fix in next sprint:
[ ] S7  → crypto.randomInt for OTP
[ ] S8  → bcrypt hash OTP before storing
[ ] S9  → Mask mobile in logs
[ ] S10 → rate-limit-mongo shared store
[ ] S12 → Always run HMAC check (remove env-var guard)
[ ] S13 → Add npm test + write auth/scope test suite
[ ] S14 → npm audit fix in backend + frontend

MEDIUM — Fix in next sprint (same as High):
[ ] S15 → Remove devOtp response field
[ ] S16 → Remove 123456 bypass
[ ] S17 → crypto.randomBytes for referral code
[ ] S18 → httpOnly cookies instead of localStorage
[ ] S19 → Tighten CSP in nginx
[ ] S20 → Protect /voter/confirm-registration
[ ] S21 → Require auth on /validate-epic
[ ] S22 → Remove mobile hint from search-epic
[ ] S23 → Stream Excel export with hard cap
[ ] S25 → Re-validate address from voter DB on registration
[ ] S26 → Delete OTP session on verification success
[ ] S27 → Atomic upsert for User creation
[ ] S28 → SENTRY_DSN from env var

LOW — Cleanup sprint:
[ ] S29 → waDiag.sh permissions
[ ] S30 → Move seed scripts
[ ] S31 → Remove dist.tar.gz from git
[ ] S32 → Remove duplicate GeoJSON
[ ] S33 → Add GitHub Actions CI
[ ] S35 → Restrict /api/health response
```

---

*Fix prompts generated from live verified audit — 2026-10-14*  
*Reference: BJP_SCHEMES_AUDIT.md (35 findings) + LOCAL_SECURITY_AUDIT_REPORT.md (30 failed)*
