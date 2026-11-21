# Security Policy

## Supported versions

Only the latest code on `main` (and the deployment built from it) receives security fixes.

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for security problems.**

Report it privately through GitHub:
[**Report a vulnerability**](https://github.com/oscarandrespabonestrella/Amika/security/advisories/new)
(Security tab → _Report a vulnerability_).

Please include:

- what is affected (route, feature, migration or RLS policy);
- steps to reproduce or a proof of concept;
- the impact you think it has (for example, reading another user's plays).

You can expect an acknowledgement within a week. Once the issue is confirmed and fixed, you will be credited in
the advisory unless you prefer to stay anonymous.

## Scope

Especially relevant for this project:

- Row Level Security bypasses (one user reading or changing another user's data);
- authentication or authorisation flaws in Server Actions, Route Handlers or the Clerk webhook;
- secrets reaching the client bundle;
- XSS, CSRF or open redirects.

Out of scope: issues in Clerk, Supabase, Vercel or BoardGameGeek themselves (report those to the vendor),
denial of service, and findings that need a compromised device.

The design behind these protections is described in [`docs/SECURITY.md`](docs/SECURITY.md).
