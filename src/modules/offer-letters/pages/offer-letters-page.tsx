"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, FileClock, FileSignature, Scale } from "lucide-react";
import { Alert, Card, DataTable, Grid, Stack, StatCard, StatusBadge, Steps, Text, type DataTableColumn } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useApplications, useLookups } from "@/lib/data/hooks";
import { date, money, moneyShort } from "@/lib/format";
import type { Application } from "@/lib/data/types";
import { daysBetween } from "../../credit-admin/common";
import { displayStatus, expiresAt, letterStatusTones, useOfferLetters, type LetterDisplayStatus, type OfferLetter } from "../store";

type Row = { letter: OfferLetter; app?: Application; obligorName: string; status: LetterDisplayStatus; expires?: string };

export function OfferLettersPage() {
  const letters = useOfferLetters();
  const apps = useApplications();
  const { obligor } = useLookups();

  const rows: Row[] = useMemo(
    () =>
      letters
        .map((letter) => {
          const app = apps.find((a) => a.id === letter.applicationId);
          return { letter, app, obligorName: (app && obligor.get(app.obligorId)?.name) ?? "—", status: displayStatus(letter), expires: expiresAt(letter) };
        })
        .sort((a, b) => b.letter.updatedAt.localeCompare(a.letter.updatedAt)),
    [letters, apps, obligor],
  );

  const count = (s: LetterDisplayStatus) => rows.filter((r) => r.status === s).length;
  const inReview = rows.filter((r) => r.status === "Draft" || r.status === "Legal review");
  const issued = rows.filter((r) => r.status === "Issued");
  const accepted30 = rows.filter((r) => r.status === "Accepted" && r.letter.acceptedAt && daysBetween(r.letter.acceptedAt) <= 30);

  const columns: DataTableColumn<Row>[] = [
    {
      id: "ref",
      header: "Letter",
      accessor: (r) => r.letter.ref,
      sortable: true,
      cell: (r) => (
        <Stack gap="none">
          <span className="font-mono text-sm font-medium text-fg">{r.letter.ref}</span>
          <span className="text-xs text-fg-subtle">{r.letter.id}</span>
        </Stack>
      ),
    },
    { id: "obligor", header: "Obligor", accessor: (r) => r.obligorName, sortable: true, cell: (r) => <span className="font-medium text-fg">{r.obligorName}</span> },
    { id: "product", header: "Facility", accessor: (r) => r.app?.product ?? "—", sortable: true },
    { id: "amount", header: "Amount", accessor: (r) => r.app?.amount ?? 0, numeric: true, align: "end", sortable: true, cell: (r) => (r.app ? moneyShort(r.app.amount) : "—") },
    { id: "status", header: "Status", accessor: (r) => r.status, sortable: true, cell: (r) => <StatusBadge status={r.status} tones={letterStatusTones} /> },
    { id: "template", header: "Template", accessor: (r) => `v${r.letter.templateVersion}`, cell: (r) => <span className="font-mono text-xs">v{r.letter.templateVersion}</span> },
    { id: "clauses", header: "Clauses", accessor: (r) => r.letter.clauseIds.length + r.letter.customClauses.length, numeric: true, align: "end" },
    {
      id: "issued",
      header: "Issued / expires",
      accessor: (r) => r.letter.issuedAt ?? "",
      sortable: true,
      cell: (r) =>
        r.letter.issuedAt ? (
          <Stack gap="none">
            <span className="font-mono text-xs">{date(r.letter.issuedAt)}</span>
            {r.status === "Issued" || r.status === "Expired" ? <span className={r.status === "Expired" ? "text-xs text-danger-strong" : "text-xs text-fg-subtle"}>{r.status === "Expired" ? "Lapsed" : "Valid to"} {date(r.expires!)}</span> : null}
          </Stack>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    { id: "accepted", header: "Accepted", accessor: (r) => r.letter.acceptedAt ?? "", sortable: true, cell: (r) => (r.letter.acceptedAt ? <span className="font-mono text-xs">{date(r.letter.acceptedAt)}</span> : <span className="text-fg-subtle">—</span>) },
    { id: "app", header: "Application", accessor: (r) => r.letter.applicationId, hidden: true },
  ];

  return (
    <ModulePage module="offer-letters" description="Auto-generated offer letters merged into the tenant's house template, reviewed by Legal clause by clause, issued and accepted.">
      <Stack gap="large">
        <Grid columns={{ base: 1, sm: 2, lg: 4 }} gap="medium">
          <StatCard label="Draft & in Legal review" value={String(inReview.length)} icon={<Scale aria-hidden />} hint={`${count("Draft")} draft · ${count("Legal review")} with Legal`} />
          <StatCard label="Issued — awaiting acceptance" value={String(issued.length)} icon={<FileClock aria-hidden />} tone="info" hint={issued.length ? `${moneyShort(issued.reduce((s, r) => s + (r.app?.amount ?? 0), 0))} on offer` : "None outstanding"} />
          <StatCard label="Accepted (30 days)" value={String(accepted30.length)} icon={<CheckCircle2 aria-hidden />} tone="success" hint={`${count("Accepted")} accepted in total`} />
          <StatCard label="Expired offers" value={String(count("Expired"))} icon={<CalendarClock aria-hidden />} tone="danger" hint="Validity lapsed before acceptance (§7.3)" />
        </Grid>

        <Card padding="medium">
          <Stack gap="medium">
            <Stack gap="xsmall">
              <Text variant="eyebrow">Offer letter lifecycle · PRD §6.1.1 steps 13–14, §7</Text>
              <Text tone="muted" variant="small">
                The letter is generated automatically when an application reaches the customer-presentation step. Legal reviews, adds, removes or edits clauses (every change tracked) and signs off before release.
              </Text>
            </Stack>
            <Steps
              orientation="horizontal"
              items={[
                { title: "Auto-generated", description: "House template + auto-tagged clauses (§6.1.5)", meta: `${count("Draft")} draft` },
                { title: "Legal review", description: "Clause-level review & sign-off", meta: `${count("Legal review")} in review` },
                { title: "Issued", description: "Presented by the Account Officer", meta: `${issued.length} issued` },
                { title: "Accepted", description: "Signed duplicate & acceptance under seal", meta: `${count("Accepted")} accepted` },
              ]}
            />
          </Stack>
        </Card>

        {count("Expired") > 0 ? (
          <Alert tone="warning" title={`${count("Expired")} offer${count("Expired") > 1 ? "s have" : " has"} lapsed`}>
            Offers lapse when not accepted within the validity period. Legal can re-issue a lapsed letter from its record.
          </Alert>
        ) : null}

        <DataTable
          label="Offer letters"
          columns={columns}
          data={rows}
          getRowId={(r) => r.letter.id}
          getRowHref={(r) => `/offer-letters/letter/?id=${r.letter.id}`}
          linkComponent={Link}
          searchable
          searchPlaceholder="Search reference, obligor or application"
          filters={[
            { id: "status", label: "Status" },
            { id: "product", label: "Facility" },
          ]}
          defaultSort={{ id: "issued", direction: "desc" }}
          exportFilename="offer-letters.csv"
          emptyState={<Text tone="muted">No offer letters match these filters.</Text>}
          mobileCard={(r) => (
            <Stack gap="xsmall">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium text-fg">{r.letter.ref}</span>
                <StatusBadge status={r.status} tones={letterStatusTones} />
              </div>
              <span className="font-medium text-fg">{r.obligorName}</span>
              <span className="text-sm text-fg-muted">
                {r.app?.product} · <span className="font-mono">{r.app ? money(r.app.amount) : "—"}</span>
              </span>
            </Stack>
          )}
        />
        <div className="flex items-start gap-2 text-sm text-fg-muted">
          <FileSignature aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>Letters use the tenant&apos;s currently-approved house template; previously-issued letters keep the template version they were issued on (PRD §7.0).</span>
        </div>
      </Stack>
    </ModulePage>
  );
}
