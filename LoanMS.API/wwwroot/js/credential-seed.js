/* credential-seed.js — Legacy local-credential cleanup
 * Load order: JUST BEFORE efin-app.js
 *
 * This file previously seeded a hardcoded table of SHA-256 password
 * hashes into localStorage (key efin_credentials_v1) and force-reset it
 * on every version bump. That table was used to authenticate users
 * entirely client-side (offline/local-only login), independent of the
 * backend. It is no longer seeded, read, or written anywhere in the app —
 * the ASP.NET Core backend (POST /api/auth/login, validated via
 * GET /api/auth/me) is the sole source of truth for authentication, and
 * password changes/resets go through POST /api/users/change-password and
 * POST /api/users/{id}/reset-password.
 *
 * Phase 1: efin-app.js's own local credential store (efin_credentials_v1,
 * plus the _setPassword/_loadCredentials/_saveCredentials helpers and the
 * dead "first-run admin password setup" wizard that wrote to it) has now
 * been removed entirely. This cleanup script purges any leftover copies of
 * that key — and the two legacy offline-login keys below — from browsers
 * that still have them from before this fix, so no password/credential
 * data of any kind is left sitting in localStorage.
 */
(function() {
  try {
    localStorage.removeItem('efin_credentials_v1');
    localStorage.removeItem('efin_cred_version');
    localStorage.removeItem('efin_ua_creds_v2');
  } catch (e) {}
})();
