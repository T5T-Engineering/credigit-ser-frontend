# credigit-ser-frontend

Core web application for **Smart Enterprise Risk 360°** by Credigit Analytical Limited: multi-tenant credit and
enterprise risk management for Nigerian commercial banks, merchant banks and microfinance banks.

This repository is the **customer prototype**. It has a complete screen for every PRD module: origination and the
approval chart-flow, 360 RAR analysis, offer letters, credit administration, disbursement, monitoring, collateral,
portfolio & MIS, IFRS 9 / ICAAP, market, operational and enterprise risk, AI analytics, connectors, administration and
audit. All of it runs on realistic, fictional demo data (demo tenant **Harbourline Bank**) behind a data layer built to be
swapped for the real backend.

- **UI:** every visual building block comes from the shared library `@credigit/web-ui`
  ([credigit-ser-web-component](https://github.com/T5T-Engineering/credigit-ser-web-component)). This app holds routes,
  page compositions, data access, domain logic and copy only. There are no app-level UI components, colours or fonts.
- **Product source of truth:** the PRD in [credigit-ser-claude-works](https://github.com/T5T-Engineering/credigit-ser-claude-works)
  (`README.md`, Appendix A). Section numbers on screen (e.g. "PRD §6.1") refer to it.
- **Conventions (binding):** [`docs/FRONTEND-CONVENTIONS.md`](docs/FRONTEND-CONVENTIONS.md).
- **Open product questions:** [`docs/OPEN-QUESTIONS.md`](docs/OPEN-QUESTIONS.md). Each one has the assumption the prototype uses.

Stack: Next.js 16 (static export), React 19.3, TypeScript, Tailwind CSS 4, zustand, MSAL.js (Microsoft Entra ID),
date-fns and faker (deterministic demo data).

## Run locally

Requires Node.js 22+.

```bash
npm install
npm run dev          # http://localhost:8061
```

Other scripts: `npm run build` (static export to `out/`), `npm run lint`, `npm run typecheck`, `npm test`.

### Developing against a local copy of the UI library

`@credigit/web-ui` installs from GitHub by default. To work on the library and the app together, clone
`credigit-ser-web-component` next to this folder and link it:

```bash
npm install ../credigit-ser-web-component --no-save
npm run dev
```

`next.config.ts` detects the symlink and makes React resolve to this app's single copy. Running a plain `npm install`
again replaces the link with the GitHub version.

## Demo access

With `NEXT_PUBLIC_DEMO_ACCESS=true` (the default), the sign-in page has a **role picker**. Choose any of the 25 default
roles from PRD §4.1 to sign in as that role's seeded user. Navigation, actions and dashboards change with the role.
Once signed in, the user menu has a **Switch demo role** option.

You can also sign straight in for a role by adding `?demoRole=<role-id>` to any app URL. This is handy for shared demo
links and screenshots:

```text
http://localhost:8061/dashboard/?demoRole=cro
http://localhost:8061/inbox/?demoRole=group-head
http://localhost:8061/admin/parameters/?demoRole=system-admin
```

The role ids are in `src/lib/rbac/roles.ts`. Some examples: `account-officer`, `bdm`, `credit-analyst`, `group-head`, `cco`,
`directorate-head`, `cro`, `head-of-risk`, `md`, `system-admin` and `it-support`.

Changes you make (applications, decisions, users, parameters, branding) are saved in **this browser only**. To restore
the original data, use the command palette (Ctrl/⌘ K → "Reset
demo data"). To hide demo access in a deployment, set `NEXT_PUBLIC_DEMO_ACCESS=false`.

## Microsoft single sign-on (Entra ID)

Microsoft sign-in uses MSAL.js with a popup and the authorization-code flow with PKCE. It turns on when
`NEXT_PUBLIC_AZURE_AD_CLIENT_ID` is set. The code is in `src/lib/auth/msal.ts` and the sign-in page is
`src/modules/auth/login-page.tsx`.

1. **Register an app** in the [Microsoft Entra admin centre](https://entra.microsoft.com): *Identity → Applications →
   App registrations → New registration*.
   - Supported account types: *Single tenant* (one bank) or *Multitenant* (any work account).
   - Platform: **Single-page application (SPA)**. Don't use "Web": an SPA registration is what allows PKCE without a secret.
2. **Redirect URIs** (SPA platform). Add one for every origin you use, with the trailing slash:
   - `http://localhost:8061/login/` (local development)
   - `https://<your-site>.netlify.app/login/` and any custom domain, e.g. `https://risk.examplebank.ng/login/`
3. **API permissions:** Microsoft Graph `openid`, `profile` and `email` (delegated). These are granted by default.
4. **Optional: app roles.** To map Entra users to Smart Enterprise Risk 360° roles, open *App roles → Create app role*,
   allow *Users/Groups* as members, and set each role's **Value** to one of our role ids (e.g. `credit-analyst`,
   `cro`, `system-admin`). Then assign users or groups under *Enterprise applications → <app> → Users and groups*. The
   role comes from the ID token's `roles` claim. Without an app role, a user whose email matches someone in
   **Admin → Users** gets that user's role. Anyone else picks a role on the sign-in page (prototype behaviour).
5. **Environment variables.** Copy `.env.example` to `.env.local` locally, or set them in Netlify:

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` | Application (client) ID. Leave empty to turn Microsoft sign-in off. |
   | `NEXT_PUBLIC_AZURE_AD_TENANT_ID` | Directory (tenant) ID, or `organizations` for any work account |
   | `NEXT_PUBLIC_AZURE_AD_REDIRECT_URI` | Optional. Defaults to `<origin>/login/` |
   | `NEXT_PUBLIC_DEMO_ACCESS` | `true` shows the demo role picker; `false` allows Microsoft sign-in only |
   | `NEXT_PUBLIC_APP_ENVIRONMENT` | Environment label in the sidebar and header badge (e.g. `Development`, `UAT`). Leave empty in production to hide it. |

   These are public build-time values. They identify the app and contain no secrets. Rebuild after changing them.

MFA and conditional access are enforced by the bank's own Entra ID policies (PRD §4, §10.1). The prototype records
every sign-in, sign-out and role switch in the audit log. The idle-timeout warning follows PRD §4.2.

> Prototype note: authorisation here is cosmetic (it hides what a role can't use). The backend must enforce roles, limits,
> segregation of duties and tenant isolation.

## Branding: colours, logo and font

Each tenant can change the application's **colours, logo and font at runtime** under **Settings → Branding**. Everything
restyles instantly: the shell, buttons, charts, tables and logo.

- **Colours:** primary (Ink), accent (Ember) and neutral (Slate). Contrast is checked against WCAG AA.
- **Logos:** horizontal, reverse (dark backgrounds) and symbol, in SVG, PNG or WebP up to 512 KB.
- **Font:** Baloo 2 (default, self-hosted), a curated list of Google Fonts, or any Google Fonts family by name.
- **Tenant presets:** Credigit default plus fictional demo tenants (Harbourline Bank, Sahel Microfinance Bank, Atlantic
  Merchant Bank). Share a preset with `/settings/branding/?preset=harbourline` (also `sahel` or `atlantic`).
- **Reset to Credigit defaults** restores all of the above.

The library's `BrandProvider` and `useBrand().updateBrand({ colors, logos, font })` drive this, and the page composes
`BrandSettingsPanel`. The prototype stores the brand in the browser (`localStorage` key `credigit.brand`) and applies it
before first paint (`brandBootScript`). In production the tenant brand is loaded from the backend and passed to
`BrandProvider initialBrand`, and only the System Admin can edit it.

If the deployment has a Content Security Policy, a non-default font needs `style-src https://fonts.googleapis.com` and
`font-src https://fonts.gstatic.com`. Tenants that can't allow third-party font requests should stay on Baloo 2.

## Data layer and the backend seam

```text
src/lib/data/types.ts      shared domain types: the Risk Data Spine (obligors, facilities, applications, collateral, …)
src/lib/data/seed.ts       deterministic demo data (seeded faker); DEMO_NOW = 10 Nov 2026
src/lib/data/store.ts      zustand store persisted to localStorage, with write actions (upsert, update, remove, log)
src/lib/data/hooks.ts      read hooks (useApplications, useFacilities, …) and useDbActions(), the only API pages use
src/modules/<module>/      module pages, module-specific data/selectors and small module stores (credigit.ser.<module>)
src/lib/workflow.ts        approval chart-flow: tiers, co-signers, dissent → adjudicator
src/lib/rbac/roles.ts      default role set (PRD §4.1), module access, illustrative limits
```

Pages never touch the store directly. They read through hooks and write through `useDbActions()`, and every
state-changing action also writes an audit event (`log({ … before, after })`). To connect the real API:

1. Re-implement the hooks in `src/lib/data/hooks.ts` with React Query or similar, keeping the same names and return
   types (the types in `types.ts` are the API contract).
2. Replace `upsert` / `update` / `remove` / `log` in `useDbActions()` with mutations. The audit log becomes server-side
   and append-only.
3. Replace module stores (e.g. `credigit.ser.admin` for Rules & Parameters) with their API endpoints the same way.
4. Remove the seed and the demo role picker (`NEXT_PUBLIC_DEMO_ACCESS=false`).

Component code doesn't change. Record pages use query strings (`/origination/application?id=APP-2026001`) rather than
dynamic segments, so the static export works for records created at runtime.

## Deployment (Netlify)

`netlify.toml` builds the static export: `npm run build` publishes `out/` on Node 22. Client routes for records created
at runtime fall back to the app shell.

1. Create a Netlify site from this repository and choose the branch to deploy (see below).
2. Set the environment variables listed above under *Site configuration → Environment variables*.
3. Add the site URL's `/login/` path as an SPA redirect URI in Entra ID.

`@credigit/web-ui` installs from its GitHub repository during the build, so no extra setup is needed.

## Branches

`develop` (all work lands here) → `test` → `uat` → `staging` → `production`. Work on a feature branch, merge it into
`develop` with `--no-ff`, and promote through the environment branches. Never commit directly to an environment
branch.
