# credigit-ser-frontend — conventions

Smart Enterprise Risk 360° web app. **Customer prototype**: complete screens for every PRD module, running on
realistic mock data with a backend-ready data seam. Read with:

- `../credigit-ser-claude-works/README.md` (in this workspace: `D:/t5t/credigit-analytics/source/README.md`) — the PRD. **Product source of truth.** Section numbers below refer to it (Appendix A).
- `@credigit/web-ui` docs: `node_modules/@credigit/web-ui/docs/CONVENTIONS.md` and `BOLT-DESIGN.md`.

## Hard rules

1. **No UI components in this app (project invariant — see CLAUDE.md).** Every control is created in credigit-ser-web-component first and shared; this app only imports it from `@credigit/web-ui`. App code = routes, page compositions, data/hooks, domain logic, copy. If something is missing in the library, compose existing pieces; if that's impossible, list it as a library request in your report (don't hand-roll a component). Thin layout wrappers using library components + layout utilities are fine.
2. **No hard-coded colours or fonts.** Only theme tokens/utilities (CONVENTIONS §3). Colour, logo and font change at runtime per tenant.
3. **PRD fidelity.** Use PRD terminology, workflows, roles, formulas and phase tags. Don't invent regulatory rules, formula weights or limits. Where the PRD gives a formula, implement it on the mock data; where it doesn't, show the input and mark the gap ("Parameter — set by tenant"). Every computed figure should be traceable: show source/formula on hover or in a details panel where reasonable (PRD §2.1, §10.3).
4. **Prototype honesty.** Data is fictional (demo tenant "Harbourline Bank"). AI output is canned/simulated and always labelled "AI-drafted"/"AI-flagged" with a human sign-off action (PRD §2.3, §6.12). Connectors are simulated.
5. **Role-aware.** Pages check `useCan(module, "edit")` to show/hide actions; navigation is filtered by role. Segregation of duties: the initiator/recommender can't be the disbursement maker or checker (PRD §4.2).
6. **Every state-changing action writes to the audit log** via `useDbActions().log({...})` (who, what, entity, before/after).

## Structure

```text
src/app/(app)/<module>/...          routes (thin page.tsx files: "use client" + render a module page component)
src/modules/<module>/               module code: pages/*.tsx, data.ts (module-specific mock data + selectors), logic.ts
src/lib/data/                       shared Risk Data Spine: types.ts, seed.ts, store.ts (zustand + localStorage), hooks.ts
src/lib/rbac/roles.ts               roles (PRD §4.1), module access, canAccess
src/lib/workflow.ts                 approval chart-flow: buildApprovalChain, currentSteps, applyDecision (dissent → adjudicator)
src/lib/auth/                       Microsoft SSO (MSAL) + demo session: useSession, useRole, useCan
src/lib/nav.ts                      navigation map: module → href, sub-pages (tabs), phase, PRD ref
src/lib/format.ts                   money (₦), moneyShort (₦1.2bn), pct, date, dateTime, ago
src/components/                     app-level compositions only (shell, ModulePage wrapper) — not UI primitives
```

### Routing

- Static export (Netlify) → **no dynamic `[id]` segments.** Record pages use a query string: `/origination/application?id=APP-2026001`, read with `useSearchParams()` inside a `<Suspense>` boundary.
- Each module's sub-pages are listed in `src/lib/nav.ts` (`pages`) and rendered as tabs by the `ModulePage` wrapper.
- Every `page.tsx` under `(app)` is a client page: `"use client"` + `export default function Page() { return <XPage />; }`.

### Data

- Read shared entities with hooks from `@/lib/data/hooks` (`useObligors`, `useFacilities`, `useApplications`, `useCollateral`, `useLookups`, …). Write with `useDbActions()` (`upsert`, `update`, `remove`, `log`).
- Module-specific data (e.g. KRIs, loss events, ECL runs, market positions) goes in `src/modules/<module>/data.ts`: deterministic generators (seeded faker or fixed arrays) derived from the shared spine where it makes sense (e.g. ECL from facilities' stage/outstanding). If the module needs to persist user changes, create a small zustand store with `persist` named `credigit.ser.<module>`.
- Money in NGN; show with `money()`/`moneyShort()` and `font-mono` (tabular figures).
- "Today" for the demo is `DEMO_NOW` from `@/lib/data/seed` (2026-11-10) — use it instead of `new Date()` for ageing/DPD logic so the demo is stable.

### Page anatomy

Use the `ModulePage` wrapper (`@/components/module-page`): module header (icon, title, PRD reference, phase badge), tabs for sub-pages, content. Within pages favour: KPI row (StatCard), filters + DataTable, record pages with EntityHeader + Tabs + DescriptionList + side panels (approval chain, AI insight, documents, activity). Empty, loading and error states must exist. Phase 2/3 modules are fully designed, with a `PhaseBadge` showing when they ship.

## Checks before you report

`npx tsc --noEmit`, `npm run lint`, and visual screenshots of your pages (`bash ../credigit-ser-web-component/scripts/screenshot.sh <url> <out.png> [w] [h]`, ≤1440x1800; 390 width for mobile). The dev server runs at http://localhost:3100. Sign in first: screenshots can't log in, so use `?demoRole=<role-id>` on any app URL (demo auto sign-in for screenshots; see `src/components/auth-guard.tsx`).
