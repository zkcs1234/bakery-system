# Bugfix Requirements Document

## Introduction

Users of the Bakery Production Management System experience intermittent login failures where sign-in
fails even when correct credentials are entered, sometimes requiring several attempts before
succeeding. The failure is non-deterministic — the same valid email/password pair may succeed on one
attempt and return a 401 on the next. This disrupts shift-start workflows for all roles (admin,
supervisor, branch manager, and floor workers) and undermines trust in the authentication system.

Root-cause analysis identified seven contributing defects spanning the backend auth route
(`src/routes/auth.ts`), the Supabase client singleton (`src/lib/supabase.ts`), the authentication
middleware (`src/middleware/auth.ts`), and the frontend login form (`src/pages/auth/LoginPage.tsx`).
Together these defects create race conditions under concurrent load, email normalisation mismatches
that prevent certain accounts from ever logging in, session drops caused by slow `/auth/me` database
queries on page load, and the possibility of amplifying the race condition through double-submit.

---

## Bug Analysis

### Current Behavior (Defect)

**Shared `authClient` singleton — race condition (Cause 1)**

1.1 WHEN two or more login requests are processed concurrently THEN the shared `authClient`
singleton's in-memory Supabase session is overwritten by a later request, causing earlier requests
to receive a null or stale `authData.user` and return HTTP 401 even though the credentials were
valid.

1.2 WHEN a login request reads `authData.user` after `signInWithPassword` resolves THEN the value
may already have been replaced by a concurrent request's session, causing the backend to incorrectly
treat the login as failed.

**`normalizeEmail()` mangling — email mismatch (Causes 2 & 6)**

1.3 WHEN a user whose email contains dots (e.g. `user.name@gmail.com`) submits their credentials
THEN `express-validator`'s `normalizeEmail()` strips the dots and sends `username@gmail.com` to
Supabase, which does not match the address stored at registration, causing Supabase's
`signInWithPassword` to return an auth error and the backend to return HTTP 401.

1.4 WHEN a user whose email contains a `+` subaddress tag (e.g. `user+tag@example.com`) submits
their credentials THEN `normalizeEmail()` strips the tag before passing the email to Supabase,
causing a mismatch with the registered address and returning HTTP 401.

1.5 WHEN a user submits an email with mixed case (e.g. `User@Example.COM`) THEN `normalizeEmail()`
lowercases only the domain portion by default, potentially producing a form (`User@example.com`)
that does not match the form stored by Supabase Auth, causing login to fail.

**No retry or timeout handling on Supabase auth call (Cause 3)**

1.6 WHEN the Supabase Auth service experiences a transient network error or slow response during
`signInWithPassword` THEN the backend propagates the failure immediately as HTTP 500 or HTTP 401
with no retry, causing the user's login attempt to fail despite valid credentials.

**`/auth/me` live database query on every page load (Cause 4)**

1.7 WHEN `useAuth` mounts and calls `GET /auth/me` THEN the `authenticate` middleware issues a live
`SELECT` against the `users` table on every page load; if this query times out or Supabase is slow,
the middleware returns HTTP 401, the frontend interceptor clears the user state, and the user is
redirected to `/login` even though a valid session cookie exists.

**Cookie `sameSite` mismatch (Cause 5)**

1.8 WHEN the frontend and backend are served from different origins or subdomains in production
THEN the `sameSite: 'strict'` cookie setting prevents the browser from including the
`bakery_token` cookie in cross-origin requests, causing the `authenticate` middleware to find no
token and return HTTP 401, effectively logging the user out on every page navigation.

**No double-submit guard on the login form (Cause 7)**

1.9 WHEN a user presses the submit button or the Enter key a second time while a login request is
already in flight THEN a second concurrent `POST /auth/login` request is dispatched to the backend,
aggravating the shared-singleton race condition described in 1.1 and 1.2.

---

### Expected Behavior (Correct)

**Shared `authClient` singleton — race condition fixed**

2.1 WHEN two or more login requests are processed concurrently THEN each request SHALL use an
isolated per-request Supabase auth client instance so that no request's in-memory session can
affect another, and every request with valid credentials SHALL receive HTTP 200 with the
appropriate JWT cookie.

2.2 WHEN `signInWithPassword` resolves for any single request THEN `authData.user` SHALL reflect
only that request's authentication result, regardless of other concurrent requests.

**Email normalisation fixed**

2.3 WHEN a user whose email contains dots (e.g. `user.name@gmail.com`) submits their correct
credentials THEN the system SHALL pass the email to Supabase exactly as entered (after only basic
trimming and lowercasing of the entire address), and SHALL return HTTP 200 with a valid session
on success.

2.4 WHEN a user whose email contains a `+` subaddress tag submits their correct credentials THEN
the system SHALL preserve the full email string when calling Supabase Auth and SHALL return HTTP
200 on success.

2.5 WHEN a user submits their email in any letter-case combination THEN the system SHALL normalise
the entire address to lowercase (consistent with how Supabase Auth stores emails) without stripping
dots or tags, and SHALL return HTTP 200 for valid credentials.

**Transient failure handling**

2.6 WHEN `signInWithPassword` fails due to a transient network error (non-authentication error)
THEN the backend SHALL retry the call up to a configurable number of times with a brief delay
before returning a failure response to the client.

2.7 WHEN `signInWithPassword` succeeds after one or more retries THEN the backend SHALL complete
the login flow normally and return HTTP 200 with the JWT cookie.

**`/auth/me` optimised to avoid unnecessary database round-trips**

2.8 WHEN `GET /auth/me` is called with a valid, unexpired JWT cookie THEN the `authenticate`
middleware SHALL return the user data embedded in the JWT without issuing a live database query,
unless a policy-sensitive field (e.g. `is_active`) must be re-verified.

2.9 WHEN a user's account is deactivated after they have already received a valid JWT THEN the
system SHALL detect the deactivation within the JWT's remaining validity window and SHALL return
HTTP 401 on the next authenticated request that triggers a database re-check.

**Cookie `sameSite` configured correctly for deployment topology**

2.10 WHEN the frontend and backend are served from different origins or subdomains in production
THEN the `sameSite` cookie attribute SHALL be set to `'none'` (paired with `secure: true`) so
that the browser includes the cookie in cross-origin requests.

2.11 WHEN the frontend and backend share the same origin in production THEN `sameSite: 'strict'`
SHALL remain in effect to maximise CSRF protection.

**Double-submit prevention**

2.12 WHEN a login request is in flight THEN the submit button and the form SHALL be disabled at
the DOM level (via the `disabled` attribute) so that no additional concurrent login requests can
be dispatched regardless of how many times the user presses Enter or clicks the button.

2.13 WHEN the login response is received (success or failure) THEN the form SHALL be re-enabled
and the loading state SHALL be cleared so the user can attempt login again if needed.

---

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user submits an incorrect password THEN the system SHALL CONTINUE TO return HTTP 401
with the message "Invalid email or password" without revealing which field was wrong.

3.2 WHEN a user submits a non-existent email address THEN the system SHALL CONTINUE TO return
HTTP 401 with the same generic error message.

3.3 WHEN a user submits an email that fails basic format validation (e.g. missing `@`) THEN the
system SHALL CONTINUE TO return HTTP 400 with a validation error before any Supabase call is made.

3.4 WHEN a user submits a password shorter than 6 characters THEN the system SHALL CONTINUE TO
return HTTP 400 with a validation error before any Supabase call is made.

3.5 WHEN a user with a deactivated account submits correct credentials THEN the system SHALL
CONTINUE TO return HTTP 403 with the message "Account deactivated. Contact admin."

3.6 WHEN a user successfully authenticates THEN the system SHALL CONTINUE TO set the
`bakery_token` httpOnly cookie and return the user's profile and role-based redirect path.

3.7 WHEN a valid `bakery_token` cookie is present THEN `GET /auth/me` SHALL CONTINUE TO return
the authenticated user's profile with HTTP 200.

3.8 WHEN no cookie or Authorization header is present THEN the `authenticate` middleware SHALL
CONTINUE TO return HTTP 401.

3.9 WHEN a user logs out via `POST /auth/logout` THEN the system SHALL CONTINUE TO clear the
cookie and log the LOGOUT event to `system_logs`.

3.10 WHEN the login page loads THEN the system SHALL CONTINUE TO display the email and password
fields, the submit button, and the loading spinner while a request is in flight.

3.11 WHEN a login error is returned THEN the system SHALL CONTINUE TO display the error message
to the user on the login form.

---

## Bug Condition Summary

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type LoginAttempt {
    email: string,
    password: string,
    concurrentRequests: integer,
    networkErrorOnSupabase: boolean,
    supabaseSlowResponseMs: integer,
    pageLoadAfterLogin: boolean
  }
  OUTPUT: boolean

  // Triggers the intermittent failure when ANY of the following hold:
  RETURN (
    X.concurrentRequests > 1                          // Race on shared authClient
    OR containsDots(X.email) AND isGmailDomain(X.email)  // normalizeEmail strips dots
    OR containsPlusTag(X.email)                       // normalizeEmail strips +tag
    OR X.networkErrorOnSupabase = true                // No retry on transient failure
    OR X.supabaseSlowResponseMs > backendTimeout      // /auth/me times out, evicts session
    OR (X.pageLoadAfterLogin AND crossOriginDeployment) // sameSite:strict blocks cookie
    OR X.concurrentRequests > 1                       // Double-submit amplifies race
  )
END FUNCTION
```

### Property: Fix Checking

```pascal
// For every input that currently triggers the bug, the fixed system must handle it correctly.
FOR ALL X WHERE isBugCondition(X) DO
  result ← login'(X)
  ASSERT (
    result.httpStatus = 200
    AND result.cookieSet = true
    AND result.user != null
  )
END FOR
```

### Property: Preservation Checking

```pascal
// For all inputs that do NOT trigger the bug, behavior must remain identical before and after fix.
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT login(X) = login'(X)
END FOR
```

---

## Property-Based Testing Angles

The following properties are amenable to automated or property-based testing:

**PBT-1 — Concurrent login idempotency**
For any batch of N concurrent login requests (N ≥ 2) with the same valid credentials, all N
requests must return HTTP 200. Generator: vary N from 2–20, randomise request interleaving.

**PBT-2 — Email format invariance**
For any email address that was registered without `normalizeEmail` transformation, submitting
that exact email (with dots, `+` tags, or mixed case) must return HTTP 200 for correct credentials.
Generator: produce emails from the cross product of {dots, +tags, mixed-case} × {Gmail, non-Gmail
domains}.

**PBT-3 — Transient network resilience**
For any valid login attempt where the Supabase call fails K times (0 ≤ K < retry limit) before
succeeding, the overall login must return HTTP 200. Generator: vary K and the delay between failures.

**PBT-4 — Invalid credential consistency**
For any email/password pair where the password is incorrect, the result must always be HTTP 401
regardless of concurrency, email format, or network conditions.

**PBT-5 — Session persistence across page loads**
For any user who successfully logs in, calling `GET /auth/me` immediately after (simulating page
reload) must return HTTP 200 with the same user data, even under simulated Supabase latency.
Generator: vary Supabase response delay from 0–5 000 ms.

**PBT-6 — Double-submit safety**
For any sequence of two login submits fired in rapid succession with valid credentials, exactly
one HTTP 200 must be returned and no race-induced 401 must occur. Generator: vary the inter-submit
delay from 0–500 ms.
