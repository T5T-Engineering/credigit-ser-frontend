/** Canned "AI-drafted" credit memo summary built from the record's own data (prototype — no model call). */
import { money, moneyShort, pct } from "@/lib/format";
import { copBand, recommendationLabel } from "../logic";
import type { AppCtx } from "./context";

export function draftMemo(c: AppCtx): string {
  const { app, obligor, sector, engine, gate, rec } = c;
  const band = copBand(app.copRatio);
  const others = c.bureau[0]?.lines.filter((l) => !l.institution.includes("this bank")) ?? [];
  const otherOutstanding = others.reduce((s, l) => s + l.outstanding, 0);
  return [
    `${obligor.name} (${obligor.type}, ${sector?.name ?? "—"}) requests a ${app.requestType.toLowerCase()} ${app.product.toLowerCase()} of ${money(app.amount)} over ${app.tenorMonths} months to fund: ${app.purpose.toLowerCase()}. The request runs on the ${app.flow} chart-flow.`,
    `Financial-statement validation: declared turnover of ${moneyShort(rec.declared)} against verified bank-account credit turnover of ${moneyShort(rec.verified)} (CBA plus ${rec.otherBanks.length} other bank${rec.otherBanks.length === 1 ? "" : "s"}, after excluding inter-branch / suspense, in-and-out and reversal entries) gives a COP Ratio of ${app.copRatio?.toFixed(2) ?? "—"}${band ? ` — ${band.label}` : ""}.`,
    `360 RAR places the obligor at ${engine.position.label}, internal risk grade ${obligor.riskGrade}/10.${obligor.watchlist ? " The obligor is on the watchlist." : ""}`,
    `Bureau and CRMS: ${others.length} facilit${others.length === 1 ? "y" : "ies"} at other institutions with ${moneyShort(otherOutstanding)} outstanding${c.adverse ? ", including a non-performing line that needs explanation" : ", all performing"}.`,
    `Security: ${c.collateral.length} item${c.collateral.length === 1 ? "" : "s"} with a haircut-adjusted lending value of ${moneyShort(c.lendingTotal)} (${pct(c.coverage * 100, 0)} cover).`,
    `Key considerations:`,
    [
      `- Single-obligor exposure after this request: ${pct(gate.solUtilisation * 100)} of the limit${gate.largeExposure ? " — a large exposure" : ""}.`,
      `- Sector exposure after this request: ${pct(gate.sectorUtilisation * 100)} of the ${sector?.name ?? "sector"} limit.`,
      `- ${c.clauses.length} conditions and covenants auto-tagged from the master library.`,
    ].join("\n"),
    `System recommendation: ${recommendationLabel[engine.recommendation]}.`,
  ].join("\n\n");
}
