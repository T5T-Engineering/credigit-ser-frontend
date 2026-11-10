# Technical debt register

| ID | Area | Debt | Fix | Raised |
|---|---|---|---|---|
| TD-002 | `src/modules/admin/store.ts` | 360 RAR intensity defaults duplicated from business rules `rar.*` while the admin parameters store still exists. | Migrate Admin → Rules & parameters onto the business-rules registry and delete the admin params store. | 2026-11-10 |
