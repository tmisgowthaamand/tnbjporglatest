# TNBJP Production QA Report

- Date: 2026-09-22
- Target: https://www.tnbjp.org
- Mode: Report-only, production-safe
- Framework: React single-page application
- Scope: Public and logged-out user flows, responsive layouts, admin login boundary, public and protected API checks
- Tested-surface health score: 98/100
- Overall completion status: DONE_WITH_CONCERNS

## Executive verdict

The production application is online and the tested logged-out functionality works. This audit cannot certify every user-side and admin-side feature because the core workflows require a real mobile OTP, a registered user session, and valid admin credentials. No production data was created or modified.

## Verified user-side behavior

- Homepage renders on desktop and mobile.
- Tamil and English language switching works.
- Start button opens the mobile-number step.
- Invalid mobile numbers are blocked client-side and do not send OTP requests.
- Volunteer registration page renders on mobile.
- Volunteer OTP button remains disabled for an invalid mobile number.
- Invalid referral routes return safely to the homepage.
- Public scheme API returns 32 schemes.
- Public jurisdiction API returns successfully.
- Application and voter databases report connected.
- No browser JavaScript errors or failed production requests were observed.

## Verified admin-side behavior

- Admin login page renders on desktop and mobile.
- Invalid credentials are rejected with HTTP 401 and a visible error.
- Protected admin endpoints reject unauthenticated requests with HTTP 401.
- Authentication protection was verified for dashboard statistics, trends, coverage, map analytics, filters, applications, incomplete registrations, scheme suggestions, booth-president requests, and scheme administration.

## Not verified

### Authenticated user workflows

- OTP delivery and OTP verification
- Existing-user profile retrieval
- EPIC validation and voter lookup
- Scheme eligibility results
- Scheme application or registration submission
- Welfare card generation/download
- Referral-link generation and sharing
- Referral-member lists and status
- Authenticated volunteer submission

### Authenticated admin workflows

- Successful login and logout
- Role-specific dashboards and authorization
- Dashboard data accuracy
- Member/application search and filters
- Status changes and bulk actions
- Reports and Excel/CSV export
- Credential administration
- Incomplete registrations
- Scheme suggestions
- Booth-president approvals
- Scheme creation, editing, and deletion
- Flow-image administration

## Confirmed issue

### ISSUE-001: Tamil flow shows English validation feedback

- Severity: Low
- Category: Content / localization
- Reproduction:
  1. Open the homepage with Tamil selected.
  2. Click `தொடங்கு`.
  3. Enter `123` in the mobile-number field.
  4. Press the send icon.
- Actual result: `Please enter a 10-digit mobile number` appears in English.
- Expected result: Validation feedback should match the selected Tamil language.
- Evidence: [user-invalid-mobile.png](./user-invalid-mobile.png)

## Evidence

- [Desktop homepage](./home-desktop.png)
- [User start flow](./user-start-flow.png)
- [Tamil invalid-mobile state](./user-invalid-mobile.png)
- [English mobile homepage](./home-mobile.png)
- [Volunteer registration mobile](./volunteer-mobile.png)
- [Admin login desktop](./admin-login.png)
- [Admin login mobile](./admin-mobile.png)
- [Invalid admin login](./admin-invalid-login.png)
- [Invalid referral handling](./referral-invalid.png)

## Infrastructure evidence

- Homepage: HTTP 200
- API health: HTTP 200
- Direct backend health: HTTP 200
- Recent Nginx requests: no HTTP 5xx responses in the last 5,000 entries
- PM2 applications: online
- TLS certificate valid through 2026-12-09

