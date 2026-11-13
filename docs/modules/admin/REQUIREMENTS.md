# Users & roles (admin) — requirements

| | |
|---|---|
| Module | `src/modules/admin` (nav module `admin`; also hosts the `audit` nav module page) |
| Repo | credigit-ser-frontend |
| PRD | §4 (intro / §4.0), §4.1, §4.2, §4.3, §6.6.1 (sector limits), §10.1, §10.3, §10.4 |
| Owner (business) | System Admin (maker); second-person confirmer per ADM-OPS1 |
| Counterpart | [IdentityAccess](../../../../credigit-ser-core-backend/docs/modules/IdentityAccess/REQUIREMENTS.md) · [RulesParameters](../../../../credigit-ser-core-backend/docs/modules/RulesParameters/REQUIREMENTS.md) |
| Last reviewed | 2026-11-12 |

## 1. Purpose and scope
Tenant administration of named users, roles and sign-on limits, per-role session security and a filtered view over the business-rules registry (PRD §4, §10.4). Every change is a request routed through the Operations workflow; nothing applies on save.

- In scope: users (invite, role change, deactivate / reactivate, MFA reset), access requests list, role catalogue (rename, limits, session rules, clone custom roles), Rules & parameters screen (grouped rule editor, sector limits, read-only chart-flow), audit log viewer (`/audit`).
- Out of scope: rule definitions owned by other modules (they register their own; admin only displays/edits through `rule.change`), chart-flow configuration (origination), branding (settings), workflow/template/hook configuration (operations), sign-in itself (auth).

## 2. Users and permissions
| Role | What they do here | Permission keys |
|---|---|---|
| System Admin | Invites users, changes roles, (de)activates, resets MFA, edits roles / limits / session rules / parameters, clones roles | `identity.users.view`, `identity.users.invite`, `identity.users.change-roles`, `identity.users.deactivate`, `identity.users.reactivate`, `identity.users.reset-mfa`, `identity.users.export`, `identity.roles.create`, `identity.roles.update`, `identity.roles.delete`, `identity.roles.change-permissions`, `identity.roles.export`, `platform.parameters.view`, `rules.rules.request-change` |
| System Admin / CRO / Head of Risk | Second-person confirmation of admin changes (Operations) | `operations.items.decide` |
| Head of Risk / CRO | Approve sector-limit changes | `operations.items.decide`; requester needs `platform.sector-limits.request-change` |
| System Admin | Review self-registered access requests | `identity.access-requests.review` |
| IT Support | Read-only access; viewing the audit log is itself logged (PRD §10.1) | `audit.log.view` |
| Compliance / any role with audit access | Search, filter and export the audit trail | `audit.log.view`, `audit.log.export` |
| Any role | Notification outbox (admin area) | `notifications.outbox.view`, `notifications.outbox.export` |

## 3. Functional requirements
| ID | Requirement | Source |
|---|---|---|
| ADM-FR-01 | Users are named individuals only — no shared/generic logins (name must have ≥ `admin.user.minNameParts` words). | PRD §4 |
| ADM-FR-02 | MFA is enforced on every sign-in; users without MFA enrolment are flagged and blocked until enrolment. | PRD §4, §10.1 |
| ADM-FR-03 | System Admin invites a user with a role and branch; invitation applies after second-person approval. | PRD §4.1 (System Admin creates users); approver = assumption ADM-OPS1 |
| ADM-FR-04 | Change a user's role, deactivate and reactivate a user — each via Operations with a reason. | PRD §4.1; assumption ADM-OPS1 |
| ADM-FR-05 | Reset a user's MFA enrolment (direct security action, audited, notified). | Assumption (PRD silent on MFA reset approval) |
| ADM-FR-06 | List self-registered access requests pending in Operations (`access.request`). | PRD §4 (admin-controlled named users) |
| ADM-FR-07 | Rename roles to match the tenant organogram without a code release. | PRD §4.0 |
| ADM-FR-08 | Set sign-on / lending limits per role (core rules `rbac.limit.*`). | PRD §4.2; demo values Q3 |
| ADM-FR-09 | Per-role idle timeout, device binding and IP allow-list, tighter defaults for Disbursement Maker/Checker and Legal. | PRD §4.2; demo values W2 |
| ADM-FR-10 | Clone a role and adjust limits/session rules; change or delete custom roles via Operations. | PRD §4 ("clone and adjust") |
| ADM-FR-11 | Rules & parameters screen: grouped view of every registered rule (approvals, 360 RAR, IFRS 9, haircuts, products, platform & security) with change requests through `rule.change`. | PRD §10.4 |
| ADM-FR-12 | Sector concentration limits (% of loan book) changed via Operations (Risk review). | PRD §6.6.1, §10.4 |
| ADM-FR-13 | Product catalogue: maximum tenor per product. | PRD §6.1; demo values |
| ADM-FR-14 | Audit log viewer: filter by actor, role, action, entity, date; table/timeline; CSV export. | PRD §4, §10.1, §10.3 |
| ADM-FR-15 | IT Support's viewing of the audit log is itself logged. | PRD §10.1 |
| ADM-FR-16 | Add/remove/merge/split/re-sequence roles and approval tiers; remap co-signer/adjudicator matrix. | PRD §4.0 — **not implemented** (static RoleId set, TD-805) |
| ADM-FR-17 | Second-person confirmation for regulatory-parameter changes. | PRD §10.4; scope of "regulatory" = W1 |
| ADM-FR-18 | Permissions screen: per-role permission matrix from the backend catalogue. Changes go through `role.permissions-change`, which by default has no approval steps, so the System Admin's change is saved at once ("Save"); if a tenant adds steps, the screen shows "Request" instead. | Backend ADR-0012; user decision 2026-11-13 |
| ADM-FR-19 | Permission groups: additive permission bundles with members and optional end date. Saved at once by default (`permission-group.change` / `.membership` have no approval steps). | Backend ADR-0014; user decision 2026-11-13 |
| ADM-FR-21 | Roles & limits shows each role's module access as members actually see it (backend, from the role's current permissions), linking to Permissions to change it. | User request 2026-11-13 |
| ADM-FR-22 | The user panel shows the real second sign-in step (authenticator app or e-mailed code; Microsoft sign-in = Entra ID) and offers **Reset MFA** for app users (lost phone): backend `user.mfa-reset`, applied at once by default, audited, notified, sessions revoked; not for yourself. | Backend ADR-0017; user request 2026-11-13 |
| ADM-FR-23 | Saving on Permissions and Permission groups opens a popup saying saved, sent for approval (with the request link) or why it failed. People affected see a saved change on their next page or when they return to the tab (access re-read on navigation and tab focus). | User request 2026-11-13 |
| ADM-FR-20 | Entra role mapping: map Entra groups (object id) and app roles (value) to platform roles; a Microsoft sign-in by an unknown person matching a mapping becomes an access request. Add / remove are requests approved in Operations (`entra-mapping.change`). Permissions `identity.entra-mappings.view` / `.change`. | Backend ADR-0016, IAM-FR-29 |

## 4. Business rules and parameters
| Rule key | Meaning | Default | Source |
|---|---|---|---|
| `admin.roleName.<roleId>` | Display name per role | PRD §4.1 role name | PRD §4.0 |
| `session.idleTimeoutMinutes.<roleId>` | Idle timeout per role | 15 min (10 for disbursement maker/checker, legal) | PRD §4.2; W2 |
| `session.deviceBinding.<roleId>` | Device binding per role | on for disbursement maker/checker, legal | PRD §4.2; W2 |
| `session.ipAllowList.<roleId>` | IPv4/CIDR allow-list per role | `10.20.0.0/16` for tighter roles, else empty | PRD §4.2; W2 |
| `admin.product.maxTenorMonths.<product>` | Max tenor per product | 12 (OD/revolving), 240 (mortgage), 24 (guarantees), 60 others | PRD §6.1 — demo value |
| `admin.user.minNameParts` | Words required in a full name | 2 | Demo value |
| `admin.user.defaultInviteRole` | Role pre-selected when inviting | `account-officer` | Demo value |
| Read, owned elsewhere: `rbac.limit.<roleId>`, `approvals.stepUpThresholdNgn`, `session.idleTimeoutMinutes`, `operations.minCommentLength`, `workspace.nearLimitPct`, `origination.products`, `origination.fastTrack.variants` | — | core / origination / workspace | PRD §4.2, §6.1 |

## 5. Workflows (Operations)
| Operation type | Trigger | Steps · approvers · SLA | Source |
|---|---|---|---|
| `user.invite` | Invite user dialog | Second-person confirmation · System Admin / CRO / Head of Risk (any) · 24 h | ADM-OPS1 |
| `user.role-change` | Change role | same · 24 h | ADM-OPS1 |
| `user.deactivate` | Deactivate | same · 24 h | ADM-OPS1 |
| `user.reactivate` | Reactivate | same · 24 h | ADM-OPS1 |
| `role.custom-change` | Clone / edit / delete custom role | same · 48 h | ADM-OPS1 |
| `admin.sector-limits.change` | Sector limits tab | Risk review · Head of Risk / CRO · 48 h | PRD §6.6.1; assumption |
| `rule.change` (core) | Any rule edit on Roles & limits / Rules & parameters | Defined in core (`src/lib/platform/core.ts`) | PRD §10.4 |
| `access.request` (core) | Self-registration verified | System Admin approval · 48 h | PRD §4 |

## 6. Notifications
| Template id | When | Recipients |
|---|---|---|
| `admin.user-invited` | Invitation approved | System Admin (invitee not reached — ADM-OPS3) |
| `admin.user-role-changed` | Role change approved | The user, System Admin |
| `admin.user-deactivated` | Deactivation approved (sent before suspension) | The user, System Admin |
| `admin.user-reactivated` | Reactivation approved | The user, System Admin |
| `admin.user-mfa-reset` | MFA reset | The user |
| `admin.role-catalogue-changed` | Custom role created/updated/deleted | System Admin, Head of Risk |
| `admin.sector-limits-changed` | Sector limits approved | CRO, Head of Risk, Portfolio & MIS Officer |

## 7. Events and hook points
| Kind | Name | When | Payload / can veto? |
|---|---|---|---|
| event | `admin.user.invited` | Invite applied | `{ roleId, branch }` |
| event | `admin.user.role-changed` | Role change applied | `{ from, to }` |
| event | `admin.user.deactivated` / `admin.user.reactivated` | Status change applied | `{ reason }` |
| event | `admin.user.mfa-reset` | MFA reset | — |
| event | `admin.role.cloned` / `.updated` / `.deleted` | Custom role change applied | `{ clonedFrom }` |
| event | `admin.sector-limits.changed` | Sector limits applied | `{ changes[] }` |
| hook (before) | `admin.user.change.before` | Before user invite/role/status/MFA change is submitted | Can veto / enrich |
| hook (after) | `admin.user.change.after` | After submission (or MFA reset applied) | Observe |
| hook (before) | `admin.config.change.before` | Before rule / role / sector-limit change is submitted | Can veto / enrich |
| hook (after) | `admin.config.change.after` | After submission to Operations | Observe |

## 8. Integration points
| Connector / system | Direction | Trigger | Data | Status |
|---|---|---|---|---|
| Identity & Access API (backend IdentityAccess) | out/in | User/role operations applied | Users, roles, permissions | Not wired (local store) |
| Rules & Parameters Engine API | in/out | Rule reads / approved changes | Rule values, history | Not wired (localStorage) |
| Microsoft Entra ID | in | Sign-in | Identity, MFA | Auth module; admin shows MFA flag only |

## 9. Non-functional
- Audit: every applied change logs who/what/before/after; audit events carry IP and device (PRD §4). Audit log is read-only in UI.
- Separation of duties: requester can never approve their own admin operation (engine-enforced).
- Protected administrator permissions (`identity.users.*`, `identity.roles.*`, `identity.permissions.*`, `identity.access-requests.review`) cannot be revoked from the admin role (backend catalogue, BE-33).
- Tenant isolation: all data scoped to the signed-in tenant (single demo tenant in the prototype).

## 10. Open questions
| ID | Question | Current assumption |
|---|---|---|
| ADM-OPS1 | Who approves admin changes? | Second System Admin, CRO or Head of Risk |
| ADM-OPS3 | Invitee gets no notification (Pending users not reachable) | Only System Admin notified |
| W1 | Which parameters are "regulatory" and who confirms? | Every rule change routes through `rule.change` |
| W2 | Session timeout / device binding / IP allow-list defaults | 15 / 10 min; internal range for tighter roles |
| W3 | Role tier numbering vs 7-tier chart-flow | See OPEN-QUESTIONS |
| W6 | Time-box for IT Support business-data access | Not time-boxed; viewing logged once per session |
| 3 | Sign-on limits per tier | Illustrative NGN values |
| ADM-Q1 | PRD §4 requires cloning roles (ADM-FR-10), but cloned roles can't be assigned to users yet (TD-805). Confirm hiding the action until they can. | "Request clone" hidden in Roles & limits; requirement kept |
