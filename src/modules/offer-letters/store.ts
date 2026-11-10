"use client";

/**
 * Offer Letter Engine data (PRD §7). Persisted in this browser as `credigit.ser.offer-letters`.
 *
 * Seeded letters are derived deterministically from the shared applications (stage Offer → Booked);
 * the store only keeps records the user created or changed (by id), merged over the derived seed.
 * BACKEND SEAM: replace `saveLetter` / `saveClause` / `saveTemplate` with API mutations.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { useApplications, useCollateral, useObligors } from "@/lib/data/hooks";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Application, Collateral, Obligor, User } from "@/lib/data/types";
import { getRule } from "@/lib/platform/rules";
import { addDaysIso, pristineSeed } from "../credit-admin/common";
import { seedClauses, type Clause, type ClauseLibrary } from "./library";
import { seedTemplates, type HouseTemplate } from "./template";

export type LetterStatus = "Draft" | "Legal review" | "Issued" | "Accepted";
export type LetterDisplayStatus = LetterStatus | "Expired";

export type CustomClause = { id: string; library: ClauseLibrary; title: string; text: string; source: "AI-drafted" | "Legal drafted"; addedByName: string; addedAt: string };
export type LetterVersion = { version: number; at: string; byName: string; summary: string };
export type LetterComment = { id: string; authorName: string; role: string; body: string; at: string };

export type OfferLetter = {
  id: string;
  applicationId: string;
  ref: string;
  templateId: string;
  templateVersion: number;
  clauseIds: string[];
  /** Letter-specific wording edits by Legal (clause id → text). */
  clauseEdits: Record<string, string>;
  customClauses: CustomClause[];
  validityDays: number;
  status: LetterStatus;
  createdAt: string;
  updatedAt: string;
  legalReviewerName?: string;
  legalSignedOffByName?: string;
  legalSignedOffAt?: string;
  issuedAt?: string;
  /** Customer acceptance date (from the signed duplicate). */
  acceptedAt?: string;
  acceptanceRecordedByName?: string;
  versions: LetterVersion[];
  comments: LetterComment[];
};

export const OFFER_STAGES: Application["stage"][] = ["Offer", "Conditions", "Disbursement", "Booked"];

export const letterStatusTones = {
  Draft: "neutral",
  "Legal review": "info",
  Issued: "brand",
  Accepted: "success",
  Expired: "danger",
} as const;

export function letterIdFor(applicationId: string) {
  return `OL-${applicationId.replace(/^APP-/, "")}`;
}

/** Display status: an issued letter lapses after its validity period if not accepted (PRD §7.3 Acceptance validity). */
export function displayStatus(letter: OfferLetter): LetterDisplayStatus {
  if (letter.status === "Issued" && letter.issuedAt && new Date(addDaysIso(letter.issuedAt, letter.validityDays)) < DEMO_NOW) return "Expired";
  return letter.status;
}

export function expiresAt(letter: OfferLetter): string | undefined {
  return letter.issuedAt ? addDaysIso(letter.issuedAt, letter.validityDays) : undefined;
}

// ---------------- Auto-tagging (Recommendation Engine, PRD §6.1.5) ----------------

export type TagContext = {
  product: Application["product"];
  obligorType: Obligor["type"];
  sectorId: string;
  currency: "NGN" | "USD";
  collateralTypes: Collateral["type"][];
  covenants: string[];
};

export function tagContextFor(app: Application, obligor: Obligor | undefined, collateral: Collateral[], currency: "NGN" | "USD" = "NGN"): TagContext {
  return {
    product: app.product,
    obligorType: obligor?.type ?? "Corporate",
    sectorId: obligor?.sectorId ?? "",
    currency,
    collateralTypes: collateral.filter((c) => app.collateralIds.includes(c.id)).map((c) => c.type),
    covenants: app.covenants,
  };
}

/** Why a clause was tagged (for the "auto-tagged because…" hint). Undefined = not tagged. */
export function tagReason(clause: Clause, ctx: TagContext): string | undefined {
  const r = clause.rule;
  if (r.all) return "Applies to all loan types";
  if (r.covenantTag && ctx.covenants.includes(r.covenantTag)) return "Covenant tagged at origination";
  if (r.products?.includes(ctx.product)) return `Product: ${ctx.product}`;
  if (r.obligorTypes?.includes(ctx.obligorType)) return `Obligor type: ${ctx.obligorType}`;
  const col = r.collateralTypes?.find((t) => ctx.collateralTypes.includes(t));
  if (col) return `Collateral: ${col}`;
  const unsecured = getRule<string[]>("offer-letters.unsecuredCollateralTypes");
  if (r.secured && ctx.collateralTypes.some((t) => !unsecured.includes(t))) return "Secured facility";
  if (r.foreignCurrency && ctx.currency !== "NGN") return `Foreign-currency facility (${ctx.currency})`;
  if (r.sectorIds?.includes(ctx.sectorId)) return "Sector";
  return undefined;
}

export function autoTag(clauses: Clause[], ctx: TagContext): string[] {
  return clauses.filter((c) => c.status !== "Retired" && tagReason(c, ctx)).map((c) => c.id);
}

export function templateFor(templates: HouseTemplate[], product: Application["product"]): HouseTemplate {
  const line = getRule<string[]>("offer-letters.contingentTemplateProducts").includes(product) ? "Contingent facilities" : "All products";
  const approved = templates.filter((t) => t.status === "Approved");
  return approved.find((t) => t.productLine === line) ?? approved.find((t) => t.productLine === "All products") ?? templates[0]!;
}

// ---------------- Seed derivation ----------------

function clampToNow(iso: string) {
  return new Date(iso) > DEMO_NOW ? DEMO_NOW.toISOString() : iso;
}

export function newLetterFor(app: Application, ctx: TagContext, clauses: Clause[], templates: HouseTemplate[], byName: string, at: string): OfferLetter {
  const tpl = templateFor(templates, app.product);
  const seq = app.id.replace(/^APP-\d{4}/, "");
  return {
    id: letterIdFor(app.id),
    applicationId: app.id,
    ref: `${getRule<string>("offer-letters.referencePrefix")}/${new Date(at).getFullYear()}/${seq}`,
    templateId: tpl.id,
    templateVersion: tpl.version,
    clauseIds: autoTag(clauses, ctx),
    clauseEdits: {},
    customClauses: [],
    validityDays: getRule<number>("offer-letters.validityDaysDefault"),
    status: "Draft",
    createdAt: at,
    updatedAt: at,
    versions: [{ version: 1, at, byName, summary: `Auto-generated from approved application ${app.id} into "${tpl.name}" v${tpl.version}; ${autoTag(clauses, ctx).length} clauses auto-tagged` }],
    comments: [],
  };
}

function seedLetters(apps: Application[], obligors: Obligor[], collateral: Collateral[], users: User[], clauses: Clause[], templates: HouseTemplate[]): OfferLetter[] {
  const legal = users.find((u) => u.roleId === "legal-officer")?.name ?? "Legal Officer";
  const out: OfferLetter[] = [];
  for (const stage of OFFER_STAGES) {
    apps
      .filter((a) => a.stage === stage)
      .sort((a, b) => a.id.localeCompare(b.id))
      .forEach((app, ord) => {
        const obligor = obligors.find((o) => o.id === app.obligorId);
        const ao = users.find((u) => u.id === app.createdById)?.name ?? "Account Officer";
        const created = clampToNow(addDaysIso(app.updatedAt, 1));
        const l = newLetterFor(app, tagContextFor(app, obligor, collateral), clauses, templates, "Offer Letter Engine", created);
        // Lifecycle by stage (ordinal varies the Offer / Conditions stages so every state is represented).
        const target: LetterStatus | "Expired" =
          stage === "Offer" ? (["Draft", "Legal review", "Expired"] as const)[ord % 3]! : stage === "Conditions" ? (ord === 0 ? "Issued" : "Accepted") : "Accepted";
        if (target === "Draft") {
          out.push(l);
          return;
        }
        l.status = "Legal review";
        l.legalReviewerName = legal;
        l.versions.push({ version: 2, at: clampToNow(addDaysIso(created, 0.2)), byName: legal, summary: "Picked up for Legal review" });
        if (target === "Legal review") {
          l.comments.push({ id: `${l.id}-c1`, authorName: legal, role: "Legal Officer", body: "Reviewing security clauses against the perfection status in the collateral register.", at: clampToNow(addDaysIso(created, 0.3)) });
          out.push(l);
          return;
        }
        const issued = target === "Expired" ? addDaysIso(DEMO_NOW, -12) : target === "Issued" ? addDaysIso(DEMO_NOW, -3) : clampToNow(addDaysIso(created, 1));
        l.status = "Issued";
        l.legalSignedOffByName = legal;
        l.legalSignedOffAt = issued;
        l.issuedAt = issued;
        l.versions.push({ version: 3, at: issued, byName: legal, summary: "Legal sign-off on conditions & covenants text; released to Account Officer for customer presentation" });
        if (target === "Accepted") {
          const accepted = clampToNow(addDaysIso(issued, 3));
          l.status = "Accepted";
          l.acceptedAt = accepted;
          l.acceptanceRecordedByName = ao;
          l.versions.push({ version: 4, at: accepted, byName: ao, summary: "Customer acceptance recorded (signed duplicate and Memorandum of Acceptance received)" });
        }
        l.updatedAt = l.versions[l.versions.length - 1]!.at;
        out.push(l);
      });
  }
  return out;
}

// ---------------- Store ----------------

type OfferLetterStore = {
  letters: Record<string, OfferLetter>;
  clauses: Record<string, Clause>;
  templates: Record<string, HouseTemplate>;
  saveLetter: (letter: OfferLetter) => void;
  saveClause: (clause: Clause) => void;
  saveTemplate: (template: HouseTemplate) => void;
  reset: () => void;
};

export const useOfferLetterStore = create<OfferLetterStore>()(
  persist(
    (set) => ({
      letters: {},
      clauses: {},
      templates: {},
      saveLetter: (letter) => set((s) => ({ letters: { ...s.letters, [letter.id]: letter } })),
      saveClause: (clause) => set((s) => ({ clauses: { ...s.clauses, [clause.id]: clause } })),
      saveTemplate: (template) => set((s) => ({ templates: { ...s.templates, [template.id]: template } })),
      reset: () => set({ letters: {}, clauses: {}, templates: {} }),
    }),
    { name: "credigit.ser.offer-letters", version: 1, storage: createJSONStorage(() => localStorage), partialize: ({ letters, clauses, templates }) => ({ letters, clauses, templates }) },
  ),
);

function mergeById<T extends { id: string }>(seed: T[], overrides: Record<string, T>): T[] {
  const seen = new Set(seed.map((s) => s.id));
  return [...seed.map((s) => overrides[s.id] ?? s), ...Object.values(overrides).filter((o) => !seen.has(o.id))];
}

export function useClauses(): Clause[] {
  const overrides = useOfferLetterStore((s) => s.clauses);
  return useMemo(() => mergeById(seedClauses, overrides), [overrides]);
}

export function useTemplates(): HouseTemplate[] {
  const overrides = useOfferLetterStore((s) => s.templates);
  return useMemo(() => mergeById(seedTemplates, overrides), [overrides]);
}

/** All offer letters: derived seed merged with stored changes. */
export function useOfferLetters(): OfferLetter[] {
  const apps = useApplications();
  const obligors = useObligors();
  const collateral = useCollateral();
  const stored = useOfferLetterStore((s) => s.letters);
  // Seeded letters come from the pristine seed + original library, so they don't shift when live data changes.
  const seed = useMemo(() => {
    const p = pristineSeed();
    return seedLetters(p.applications, p.obligors, p.collateral, p.users, seedClauses, seedTemplates);
  }, []);
  return useMemo(() => {
    const known = new Set([...seed.map((l) => l.id), ...Object.keys(stored)]);
    // PRD §7: the letter is auto-generated when an application reaches the customer-presentation step.
    const auto = apps
      .filter((a) => OFFER_STAGES.includes(a.stage) && !known.has(letterIdFor(a.id)))
      .map((a) => newLetterFor(a, tagContextFor(a, obligors.find((o) => o.id === a.obligorId), collateral), seedClauses, seedTemplates, "Offer Letter Engine", a.updatedAt));
    return [...auto, ...mergeById(seed, stored)];
  }, [seed, stored, apps, obligors, collateral]);
}

export function useOfferLetter(id: string | null | undefined) {
  const letters = useOfferLetters();
  return useMemo(() => letters.find((l) => l.id === id), [letters, id]);
}

/** Selected conditions precedent on a letter (library clauses + custom pre-conditions). */
export function conditionsPrecedent(letter: OfferLetter | undefined, clauses: Clause[]): Array<{ id: string; title: string; category: string; text: string }> {
  if (!letter) return [];
  const lib = clauses
    .filter((c) => c.library === "pre" && letter.clauseIds.includes(c.id))
    .map((c) => ({ id: c.id, title: c.title, category: c.category, text: letter.clauseEdits[c.id] ?? c.text }));
  const custom = letter.customClauses.filter((c) => c.library === "pre").map((c) => ({ id: c.id, title: c.title, category: c.source, text: c.text }));
  return [...lib, ...custom];
}

/** Covenants on a letter (special + general covenants). */
export function letterCovenants(letter: OfferLetter | undefined, clauses: Clause[]) {
  if (!letter) return [];
  return [
    ...clauses.filter((c) => (c.library === "special" || (c.library === "general" && c.category === "Covenant")) && letter.clauseIds.includes(c.id)),
    ...letter.customClauses.filter((c) => c.library === "special").map((c) => ({ id: c.id, title: c.title, category: "Special covenant", library: "special" as const, text: c.text })),
  ];
}
