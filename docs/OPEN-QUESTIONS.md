# Open questions for the product owner

Ambiguities found while building the prototype. Each is implemented with a stated assumption so the demo works;
none should be treated as a product decision until confirmed. Agents: append new items below (PRD section, question, assumption made).

| # | PRD | Question | Assumption in the prototype |
|---|---|---|---|
| 1 | §6.2.5 | X/Y-Composites are written as "average + average", but postures use a 5.5 midpoint on the 1–10 scale. | Each composite = mean of the two cardinal-point averages (stays on 1–10). `src/lib/rar.ts` |
| 2 | §6.2.5 | Strong / Moderate / Marginal and Neutral thresholds are tenant parameters with no defaults given. | Demo defaults: Neutral < 0.4, Marginal < 1.2, Moderate < 2.4, else Strong. |
| 3 | §4.1 | Sign-on limits per tier are tenant values with no defaults. | Illustrative NGN limits (BDM ₦50m … BCC ₦25bn, Board apex). `src/lib/rbac/roles.ts` |
| 4 | §6.1.2 | Exact co-signer pairing per tier. | BDM → (Credit Analyst + Group Head) → (CCO + Directorate Head) → (CRO + MD) → MCC → BCC → Board; adjudicators CCO / CRO / MCC. `src/lib/workflow.ts` |
