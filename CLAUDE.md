# credigit-ser-frontend — core web application

Routes, page compositions, data/hooks, domain logic and copy only. All UI comes from `@credigit/web-ui`. Read `docs/FRONTEND-CONVENTIONS.md` before working here.

## Project invariants (apply to every Credigit SER repository)

1. **Every UI control is a shared library component first.** Any control, widget or visual building block used in a frontend (credigit-ser-frontend, credigit-ser-landing, or any future app) must be created in **credigit-ser-web-component** (`@credigit/web-ui`) first, then imported by the apps. Apps contain only routes, page compositions, data access, domain logic and copy — never their own buttons, inputs, tables, cards, charts, dialogs or similar. If a control is missing, add it to the library (with tests and docs in `docs/CONVENTIONS.md`), release it to the library `develop` branch, then use it in the app.
2. **Brand comes from tokens, never hard-coded values.** Colours, fonts and logos are runtime-configurable per tenant (BrandProvider: `updateBrand({ colors, logos, font })`). Use only the theme utilities; never hex colours, palette classes or font names in components or apps. Default font: Baloo 2.
3. **Design language: Bolt (bolt.eu).** Component design follows `credigit-ser-web-component/docs/BOLT-DESIGN.md` (pills, squircle surfaces, bold type, soft elevation) with Credigit colours, Baloo 2 and the Credigit logo.
4. **The PRD is the product source of truth.** `credigit-ser-claude-works/README.md` (Smart Enterprise Risk 360° PRD v2.1). Don't invent regulatory rules, formulas, weights, limits or provider endpoints; record ambiguities as open questions.
5. **Git workflow.** Work on a feature branch → merge (`--no-ff`) into local `develop` → push `origin develop`. Every remote has `develop`, `test`, `uat`, `staging`, `production`; never commit directly to the environment branches.
6. **Dependencies:** latest stable/LTS versions, pinned exactly.
7. **No secrets in repositories** (credigit-ser-web-component is public).
8. **No hard-coded values — business rules drive behaviour (frontend and backend).** Limits, thresholds, rates, durations, URLs, role/route mappings, labels of configurable things and similar values must come from the application's business rules (Rules & Parameters engine / tenant configuration / environment config), never literals in code. Any temporary exception is recorded in the repo's `TECH-DEBT.md` with an ID referenced in the code.
9. **Every feature is complete end-to-end.** For everything being worked on:
   - **User-scoped:** data, actions and views respect the signed-in user, their role, tenant and permissions.
   - **Audited:** every state change writes to the immutable audit log (who, what, before/after, when, where).
   - **Notified:** relevant parties receive notifications; build the notification HTML message template if one doesn't exist.
   - **Workflow-routed:** anything needing approval is routed through the **"Operations" workflow** (configurable steps, approvers, SLAs) — no ad-hoc approval logic.
   - **Extensible:** expose subscribe-able **hook points** (before/after, can veto or enrich) and **event points** (published domain events) so extensions can plug in without changing core code.
   - **Navigable:** wire up all necessary menus and sub-menus for the feature.
   - **Consistent:** respect every other invariant in this list.
10. **Caveman communication.** Agents (Claude) talk caveman to the team: short words, no filler, no pleasantries, fragments fine. Technical terms, numbers, file paths, commands and error text stay exact. Applies to chat replies and status updates only. Product copy, docs, code comments, commit messages and PR text stay normal professional English.
11. **Clear context after every push.** After every push to `origin`, the agent ends its turn with a short handoff (what was pushed, commit hash, next step) and tells the user to run `/clear`. Agents cannot run `/clear` themselves (built-in CLI command). Anything the next session needs must already be in the repo (CLAUDE.md, README, TECH-DEBT.md, open questions) before the push.
