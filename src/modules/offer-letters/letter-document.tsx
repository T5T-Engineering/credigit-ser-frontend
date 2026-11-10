"use client";

/**
 * Assembled offer letter: the tenant house template (§7.0) with merge fields filled and the selected clauses
 * (§7.1–7.3, §6.1.5) merged into their sections. Page composition from library primitives only.
 */
import { Fragment, type ReactNode } from "react";
import { DescriptionList, Divider, Logo, Stack, Text } from "@credigit/web-ui";
import type { Clause } from "./library";
import { clausesForSection, mergeParts, type MergeContext } from "./merge";
import type { OfferLetter } from "./store";
import type { HouseTemplate, TemplateSection } from "./template";

type LetterLike = Pick<OfferLetter, "clauseIds" | "clauseEdits" | "customClauses" | "validityDays" | "ref">;

export function Merged({ text, ctx, highlight }: { text: string; ctx: MergeContext; highlight?: boolean }) {
  return (
    <>
      {mergeParts(text, ctx).map((p, i) =>
        p.field ? (
          <span
            key={i}
            title={highlight ? `Merge field: {{${p.field}}}` : undefined}
            className={p.unresolved ? "rounded bg-danger-soft px-0.5 font-mono text-xs text-danger-strong" : highlight ? "rounded bg-accent-500/15 px-0.5 text-fg ring-1 ring-accent-500/30" : undefined}
          >
            {p.text}
          </span>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

function SectionTitle({ n, children }: { n?: number; children: ReactNode }) {
  return (
    <h3 className="font-display text-base font-bold tracking-tight text-fg uppercase">
      {n ? <span className="mr-2 font-mono text-fg-subtle">{n}.</span> : null}
      {children}
    </h3>
  );
}

function SignatureLine({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-1 pt-10">
      <div className="border-t border-line-strong" />
      <span className="text-sm font-medium text-fg">{label}</span>
      {sub ? <span className="text-xs text-fg-subtle">{sub}</span> : null}
    </div>
  );
}

export type LetterDocumentProps = {
  template: HouseTemplate;
  letter: LetterLike;
  clauses: Clause[];
  ctx: MergeContext;
  /** Facility terms table rows. */
  terms: Array<{ label: string; value: string }>;
  /** Security lines (collateral / guarantees). */
  security: string[];
  highlight?: boolean;
  /** Shows a "DRAFT" eyebrow until Legal signs off. */
  draft?: boolean;
  /** Section ids to emphasise (template editor). */
  focusSectionId?: string;
};

export function LetterDocument({ template, letter, clauses, ctx, terms, security, highlight, draft, focusSectionId }: LetterDocumentProps) {
  let n = 0;
  const sections = template.sections.filter((s) => s.enabled);
  const render = (s: TemplateSection): ReactNode => {
    const body = s.body ?? "";
    switch (s.kind) {
      case "letterhead":
        return (
          <Stack gap="medium">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <Logo size="medium" />
              <div className="flex flex-col items-end text-right text-xs text-fg-muted">
                <span>{template.letterhead.addressLine}</span>
                <span>{template.letterhead.contactLine}</span>
              </div>
            </div>
            <Divider />
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span>
                Our ref: <span className="font-mono text-fg">{letter.ref}</span>
              </span>
              <span className="font-mono text-fg">{ctx["letter.date"]}</span>
            </div>
          </Stack>
        );
      case "text":
        if (s.id === "subject")
          return (
            <p className="font-display text-base font-bold tracking-tight text-fg uppercase underline decoration-line-strong underline-offset-4">
              <Merged text={body} ctx={ctx} highlight={highlight} />
            </p>
          );
        return (
          <Stack gap="small">
            {s.showTitle ? <SectionTitle n={++n}>{s.title}</SectionTitle> : null}
            <p className="text-sm leading-6 whitespace-pre-line text-fg">
              <Merged text={body} ctx={ctx} highlight={highlight} />
            </p>
          </Stack>
        );
      case "facility-terms":
        return (
          <Stack gap="small">
            <SectionTitle n={++n}>{s.title}</SectionTitle>
            <DescriptionList
              columns={1}
              layout="inline"
              items={terms.map((t) => ({ label: t.label, value: <Merged text={t.value} ctx={ctx} highlight={highlight} /> }))}
            />
          </Stack>
        );
      case "security":
        return (
          <Stack gap="small">
            <SectionTitle n={++n}>{s.title}</SectionTitle>
            {security.length ? (
              <ol className="flex list-[lower-alpha] flex-col gap-1.5 pl-6 text-sm leading-6 text-fg">
                {security.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            ) : (
              <Text variant="small" tone="muted">
                As approved — see the collateral register.
              </Text>
            )}
          </Stack>
        );
      case "clauses": {
        const items = clausesForSection(letter as OfferLetter, clauses, s.library!);
        if (!items.length) return null;
        return (
          <Stack gap="small">
            <SectionTitle n={++n}>{s.title}</SectionTitle>
            <ol className="flex list-[lower-roman] flex-col gap-2.5 pl-7 text-sm leading-6 text-fg">
              {items.map((c) => (
                <li key={c.id}>
                  <span className="font-semibold">{c.title}. </span>
                  <Merged text={c.text} ctx={ctx} highlight={highlight} />
                </li>
              ))}
            </ol>
          </Stack>
        );
      }
      case "signatures":
        return (
          <Stack gap="small">
            <p className="text-sm leading-6 whitespace-pre-line text-fg">
              <Merged text={body} ctx={ctx} highlight={highlight} />
            </p>
            <div className="grid gap-6 sm:grid-cols-2">
              <SignatureLine label="Authorised signatory" sub="Credit Administration" />
              <SignatureLine label="Authorised signatory" sub="Legal" />
            </div>
          </Stack>
        );
      case "acceptance":
        return (
          <Stack gap="small">
            <Divider label="Duplicate copy — to be returned" />
            <SectionTitle>{s.title}</SectionTitle>
            <p className="text-sm leading-6 whitespace-pre-line text-fg">
              <Merged text={body} ctx={ctx} highlight={highlight} />
            </p>
            <div className="grid gap-6 sm:grid-cols-2">
              <SignatureLine label="Director" sub="Name, signature & date" />
              <SignatureLine label="Director / Company Secretary" sub="Name, signature & date" />
            </div>
            <Text variant="small" tone="muted" className="pt-4">
              In the presence of — Witness: name, address, occupation, signature
            </Text>
            <div className="grid gap-6 sm:grid-cols-2">
              <SignatureLine label="Witness" />
              <SignatureLine label="Common seal" />
            </div>
          </Stack>
        );
    }
  };

  return (
    <article aria-label="Offer letter" className="squircle mx-auto flex w-full max-w-[52rem] flex-col gap-6 rounded-3xl bg-surface p-5 shadow-sm ring-1 ring-line sm:p-10">
      {draft ? <Text variant="eyebrow" tone="accent">Draft — subject to Legal sign-off</Text> : null}
      {sections.map((s) => {
        const content = render(s);
        if (!content) return null;
        return (
          <section key={s.id} data-section={s.id} className={focusSectionId === s.id ? "rounded-2xl ring-2 ring-accent-500/40 ring-offset-4 ring-offset-surface" : undefined}>
            {content}
          </section>
        );
      })}
      <Divider />
      <p className="text-center text-xs text-fg-subtle">{template.letterhead.footer}</p>
    </article>
  );
}
