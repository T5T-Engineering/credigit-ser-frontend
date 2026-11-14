"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  Grid,
  Modal,
  Stack,
  StatCard,
  StatusBadge,
  Tabs,
  Text,
  TextLink,
  Textarea,
  type DataTableColumn,
} from "@credigit/web-ui";
import { OutcomePopup, outcomeCopy } from "@/lib/ui/outcome-popup";
import { ModulePage } from "@/components/module-page";
import { useRole } from "@/lib/auth/session";
import { useApplications, useLookups } from "@/lib/data/hooks";
import { useOperationsStore } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, moneyShort, number } from "@/lib/format";
import { PendingApproval } from "@/modules/monitoring/pending-approval";
import { daysBetween } from "@/modules/monitoring/logic";
import { collateralAbilities, perfectionIndex, perfectionSteps, perfectionTones } from "../logic";
import { advancePerfection, checkOutDocuments, recordSearch as recordSearchCmd, requestLegalSignoff, returnDocuments } from "../service";
import { useCollateralView, type CollateralView } from "../store";

type Row = CollateralView & { obligorName: string; applicationId?: string; stepOwner: string; ageDays: number };

const searchTones = { Clean: "success", "Encumbrance found": "danger", Requested: "info", "Not requested": "neutral" } as const;

export function LegalReviewPage() {
  const view = useCollateralView();
  const applications = useApplications();
  const { obligor } = useLookups();
  const role = useRole();
  const can = collateralAbilities(role?.id);
  const instances = useOperationsStore((s) => s.instances);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [signFor, setSignFor] = useState<Row | null>(null);
  const [checkoutFor, setCheckoutFor] = useState<Row | null>(null);

  const rows: Row[] = useMemo(() => {
    const appByCol = new Map<string, string>();
    for (const a of applications) if (!["Booked", "Declined", "Withdrawn"].includes(a.stage)) for (const cid of a.collateralIds) appByCol.set(cid, a.id);
    return view.map((c) => {
      const current = perfectionSteps[Math.max(0, perfectionIndex(c.perfection))]!;
      return {
        ...c,
        obligorName: obligor.get(c.obligorId)?.name ?? c.obligorId,
        applicationId: appByCol.get(c.id),
        stepOwner: c.perfection === "Defective" || current.owner === "legal-officer" ? "Legal Officer" : "Collateral Mgmt",
        ageDays: Math.max(0, daysBetween(c.legalRecord.searchAt ?? c.valuedAt, DEMO_NOW)),
      };
    });
  }, [view, applications, obligor]);

  const searches = rows.filter((r) => r.legalRecord.searchStatus === "Requested" || r.legalRecord.searchStatus === "Not requested" || (r.applicationId && r.legalRecord.searchStatus !== "Clean"));
  const perfection = rows.filter((r) => r.perfection !== "Perfected");
  const vaulted = rows.filter((r) => r.legalRecord.vaultRef);
  const signoff = rows.filter((r) => !r.legalRecord.signOff && (r.perfection === "Registration" || r.perfection === "Perfected"));

  /** Open legal sign-off operation per collateral (Operations workflow). */
  const pendingSignoff = useMemo(
    () => new Set(instances.filter((i) => i.operationType === "collateral.legal.signoff" && ["Pending", "In progress"].includes(i.status)).map((i) => i.subject.id)),
    [instances],
  );

  const recordSearch = async (r: Row, result: "Clean" | "Encumbrance found") => {
    recordSearchCmd(r, r.legalRecord.searchStatus, result);
    // A clean search on a new security moves it on to documentation.
    if (result === "Clean" && (r.perfection === "Not started" || r.perfection === "Search in progress"))
      await advancePerfection({ ...r, perfection: "Search in progress" }, "Documentation", "Clean search — advanced perfection to documentation");
  };

  const idCol: DataTableColumn<Row> = { id: "id", header: "Collateral", accessor: "id", sortable: true, cell: (r) => <TextLink as={Link} href={`/collateral/item?id=${r.id}`}>{r.id}</TextLink> };
  const obligorCol: DataTableColumn<Row> = {
    id: "obligor",
    header: "Obligor / security",
    accessor: "obligorName",
    sortable: true,
    cell: (r) => (
      <Stack gap="none">
        <span className="font-medium text-fg">{r.obligorName}</span>
        <Text variant="caption" tone="subtle">
          {r.type === "Quoted shares" ? `${r.type} · ${r.ticker}` : r.description === r.type ? r.type : `${r.type} · ${r.description}`}
        </Text>
      </Stack>
    ),
  };

  const searchCols: DataTableColumn<Row>[] = [
    idCol,
    obligorCol,
    { id: "app", header: "Application", accessor: (r) => r.applicationId ?? "", cell: (r) => (r.applicationId ? <TextLink as={Link} href={`/origination/application?id=${r.applicationId}`}>{r.applicationId}</TextLink> : <Text variant="small" tone="subtle">Existing facility</Text>) },
    { id: "registry", header: "Registry", accessor: (r) => r.legalRecord.registry ?? "" },
    { id: "status", header: "Search", accessor: (r) => r.legalRecord.searchStatus, sortable: true, cell: (r) => <StatusBadge status={r.legalRecord.searchStatus} tones={searchTones} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      cell: (r) =>
        can.legal && r.legalRecord.searchStatus !== "Clean" && r.legalRecord.searchStatus !== "Encumbrance found" ? (
          <Stack direction="horizontal" gap="small">
            <Button size="small" variant="tertiary" onClick={() => recordSearch(r, "Clean")}>
              Clean
            </Button>
            <Button size="small" variant="text" onClick={() => recordSearch(r, "Encumbrance found")}>
              Encumbrance
            </Button>
          </Stack>
        ) : null,
    },
  ];

  const perfCols: DataTableColumn<Row>[] = [
    idCol,
    obligorCol,
    { id: "value", header: "Market value", accessor: "marketValue", numeric: true, sortable: true, cell: (r) => moneyShort(r.mtm ?? r.marketValue) },
    { id: "perfection", header: "Current step", accessor: "perfection", sortable: true, cell: (r) => <StatusBadge status={r.perfection} tones={perfectionTones} /> },
    { id: "owner", header: "With", accessor: "stepOwner", sortable: true },
    { id: "genuine", header: "Genuineness", accessor: (r) => r.legalRecord.genuineness, sortable: true, cell: (r) => <StatusBadge status={r.legalRecord.genuineness} tones={{ Confirmed: "success", Pending: "info", Doubtful: "danger" }} /> },
    { id: "age", header: "Days open", accessor: "ageDays", numeric: true, sortable: true },
  ];

  const vaultCols: DataTableColumn<Row>[] = [
    { id: "ref", header: "Vault ref", accessor: (r) => r.legalRecord.vaultRef ?? "", sortable: true, cell: (r) => <span className="font-mono">{r.legalRecord.vaultRef}</span> },
    idCol,
    obligorCol,
    { id: "vaulted", header: "Vaulted", accessor: (r) => r.legalRecord.vaultedAt ?? "", sortable: true, cell: (r) => (r.legalRecord.vaultedAt ? date(r.legalRecord.vaultedAt) : "—") },
    {
      id: "custody",
      header: "Custody",
      accessor: (r) => (r.legalRecord.checkedOut ? "Checked out" : "In vault"),
      sortable: true,
      cell: (r) =>
        r.legalRecord.checkedOut ? (
          <Stack gap="none">
            <StatusBadge status="Checked out" tones={{ "Checked out": "warning" }} />
            <Text variant="caption" tone="subtle">
              {r.legalRecord.checkedOut.by} · {r.legalRecord.checkedOut.purpose}
            </Text>
          </Stack>
        ) : (
          <StatusBadge status="In vault" tones={{ "In vault": "success" }} />
        ),
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      cell: (r) =>
        can.legal ? (
          r.legalRecord.checkedOut ? (
            <Button
              size="small"
              variant="tertiary"
              onClick={() => returnDocuments(r, r.legalRecord.vaultRef)}
            >
              Return to vault
            </Button>
          ) : (
            <Button size="small" variant="tertiary" onClick={() => setCheckoutFor(r)}>
              Check out
            </Button>
          )
        ) : null,
    },
  ];

  const signCols: DataTableColumn<Row>[] = [
    idCol,
    obligorCol,
    { id: "perfection", header: "Perfection", accessor: "perfection", cell: (r) => <StatusBadge status={r.perfection} tones={perfectionTones} /> },
    { id: "search", header: "Search", accessor: (r) => r.legalRecord.searchStatus, cell: (r) => <StatusBadge status={r.legalRecord.searchStatus} tones={searchTones} /> },
    { id: "genuine", header: "Genuineness", accessor: (r) => r.legalRecord.genuineness, cell: (r) => <StatusBadge status={r.legalRecord.genuineness} tones={{ Confirmed: "success", Pending: "info", Doubtful: "danger" }} /> },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      exportable: false,
      cell: (r) =>
        pendingSignoff.has(r.id) ? (
          <PendingApproval subjectType="Collateral" subjectId={r.id} compact />
        ) : can.legal ? (
          <Button size="small" onClick={() => setSignFor(r)} disabled={r.legalRecord.searchStatus !== "Clean" || r.legalRecord.genuineness !== "Confirmed"}>
            Sign off
          </Button>
        ) : null,
    },
  ];

  return (
    <ModulePage module="collateral" description="Legal workflow — collateral search at origination (in parallel with BDM review), genuineness of security documents, vaulting and legal sufficiency sign-off.">
      <Stack gap="large">
        <OutcomePopup value={message} map={outcomeCopy.toneText({ success: "Submitted", danger: "Not completed" })} />
        {!can.legal && (
          <Alert tone="info" title="View only">
            Legal actions are performed by the Legal Officer. Your role can view the queue.
          </Alert>
        )}
        <Grid columns={{ base: 2, lg: 4 }} gap="medium">
          <StatCard label="Searches pending" value={number(searches.filter((r) => r.legalRecord.searchStatus === "Requested" || r.legalRecord.searchStatus === "Not requested").length)} tone="info" />
          <StatCard label="Perfection open" value={number(perfection.length)} hint="Not yet perfected, incl. defective" />
          <StatCard label="Defective" value={number(rows.filter((r) => r.perfection === "Defective").length)} tone="danger" />
          <StatCard label="Awaiting legal sign-off" value={number(signoff.length)} tone="warning" />
        </Grid>
        <Tabs
          label="Legal review queues"
          variant="underline"
          items={[
            {
              id: "searches",
              label: "Legal searches",
              badge: String(searches.length),
              content: <DataTable label="Legal searches" data={searches} columns={searchCols} getRowId={(r) => r.id} searchable density="compact" filters={[{ id: "status", label: "Search", columnId: "status" }]} exportFilename="legal-searches.csv" emptyState={<EmptyState title="No searches pending" />} />,
            },
            {
              id: "perfection",
              label: "Perfection tasks",
              badge: String(perfection.length),
              content: <DataTable label="Perfection tasks" data={perfection} columns={perfCols} getRowId={(r) => r.id} searchable density="compact" defaultSort={{ id: "age", direction: "desc" }} filters={[{ id: "perfection", label: "Step", columnId: "perfection" }, { id: "owner", label: "With", columnId: "owner" }]} exportFilename="perfection-tasks.csv" />,
            },
            {
              id: "vault",
              label: "Document vault",
              badge: String(vaulted.length),
              content: <DataTable label="Document vault" data={vaulted} columns={vaultCols} getRowId={(r) => r.id} searchable density="compact" filters={[{ id: "custody", label: "Custody", columnId: "custody" }]} exportFilename="document-vault.csv" />,
            },
            {
              id: "signoff",
              label: "Legal sign-off",
              badge: String(signoff.length),
              content: (
                <Stack gap="medium">
                  <Text variant="small" tone="muted">
                    Legal sufficiency sign-off on security. Sign-off on the conditions/covenants text in the auto-generated offer letter happens in{" "}
                    <TextLink as={Link} href="/offer-letters">
                      Offer letters
                    </TextLink>{" "}
                    before release to the Account Officer.
                  </Text>
                  <DataTable label="Awaiting legal sign-off" data={signoff} columns={signCols} getRowId={(r) => r.id} searchable density="compact" exportFilename="legal-signoff.csv" emptyState={<EmptyState title="Nothing awaiting sign-off" />} />
                </Stack>
              ),
            },
          ]}
        />
      </Stack>

      {signFor && (
        <NoteModal
          title="Legal sufficiency sign-off"
          subject={`${signFor.id} · ${signFor.obligorName}`}
          label="Legal opinion"
          initial="Security documents genuine; perfection complete; legally sufficient."
          cta="Submit for acceptance"
          onClose={() => setSignFor(null)}
          onSave={async (note) => {
            const r = await requestLegalSignoff(signFor, note);
            setMessage(r.ok ? { tone: "success", text: `Legal sufficiency opinion submitted for Credit Administration acceptance (${r.operationId}).` } : { tone: "danger", text: r.reason });
          }}
        />
      )}
      {checkoutFor && (
        <NoteModal
          title="Check out documents"
          subject={`${checkoutFor.legalRecord.vaultRef} · ${checkoutFor.obligorName}`}
          label="Purpose"
          initial=""
          cta="Check out"
          onClose={() => setCheckoutFor(null)}
          onSave={(purpose) => checkOutDocuments(checkoutFor, checkoutFor.legalRecord.vaultRef, purpose)}
        />
      )}
    </ModulePage>
  );
}

function NoteModal({ title, subject, label, initial, cta, onClose, onSave }: { title: string; subject: string; label: string; initial: string; cta: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(initial);
  const minText = useRule<number>("collateral.legal.minOpinionLength");
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={subject}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={v.trim().length < minText}
            onClick={() => {
              onSave(v.trim());
              onClose();
            }}
          >
            {cta}
          </Button>
        </>
      }
    >
      <Field label={label} htmlFor="legal-note" required>
        <Textarea id="legal-note" rows={3} value={v} onChange={(e) => setV(e.target.value)} />
      </Field>
    </Modal>
  );
}
