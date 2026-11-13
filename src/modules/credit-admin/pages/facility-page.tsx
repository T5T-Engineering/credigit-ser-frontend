"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, FileSearch, FileSignature, FileText, Printer, ShieldCheck, Unlock } from "lucide-react";
import {
  Alert,
  AuditTrail,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChecklistPanel,
  DataTable,
  DescriptionList,
  DocumentList,
  EmptyState,
  EntityHeader,
  Grid,
  KeyValueGrid,
  Modal,
  PermissionGate,
  ProgressBar,
  Spinner,
  Stack,
  StatusBadge,
  Tabs,
  Text,
  TextLink,
  type ChecklistItem,
  type ChecklistPanelProps,
  type ChecklistStatus,
  type DataTableColumn,
} from "@credigit/web-ui";
import { OutcomePopup, outcomeCopy } from "@/lib/ui/outcome-popup";
import { useCan } from "@/lib/auth/session";
import { useAudit, useCollateral, useDocuments, useSectors, useUsers } from "@/lib/data/hooks";
import { usePendingFor } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { useScope } from "@/lib/platform/scope";
import type { RoleId } from "@/lib/rbac/roles";
import { DEMO_NOW } from "@/lib/data/seed";
import type { Collateral } from "@/lib/data/types";
import { date, dateTime, money, moneyShort, pct } from "@/lib/format";
import { useClauses } from "../../offer-letters/store";
import { requestRelease, setConditionStatus, type ActionResult } from "../actions";
import { addDaysIso, cbnClassTones, facilityStatusTones, hash, rand } from "../common";
import { covenantsFor, covenantTones, useFacilityRow, useWaivers, waiverStatus, type CovenantRow, type FacilityRow } from "../logic";
import { PendingOperationNotice } from "../operations-ui";
import { facilityClassOf } from "../register";
import { toActivityItem, toDocumentItem, waiverStatusTones } from "../view";

export function FacilityPage() {
  return (
    <Suspense fallback={<Spinner label="Loading facility" />}>
      <FacilityRecord />
    </Suspense>
  );
}

function FacilityRecord() {
  const id = useSearchParams().get("id");
  const row = useFacilityRow(id);
  const allowed = useCan("credit-admin");
  const canEdit = useCan("credit-admin", "edit");
  const { actor } = useScope();
  const confirmerRoles = useRule<RoleId[]>("credit-admin.cpConfirmerRoles");
  const requesterRoles = useRule<RoleId[]>("credit-admin.requesterRoles");
  const isCad = canEdit && confirmerRoles.includes(actor.roleId);
  const canRaise = canEdit && requesterRoles.includes(actor.roleId);
  const pendingRelease = usePendingFor("Facility", id ?? "-");
  const [tab, setTab] = useState("overview");
  const [confirm, setConfirm] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  if (!allowed) return <PermissionGate allowed={false} description="Your role doesn't include credit administration. Switch role from the user menu to see it.">{null}</PermissionGate>;
  if (!row) {
    return (
      <EmptyState
        icon={<FileSearch aria-hidden />}
        title="Facility not found"
        description={id ? `No facility with ID ${id} exists in this tenant. It may have been removed or the demo data reset.` : "No facility ID was given."}
        action={
          <Button as={Link} href="/credit-admin/">
            Back to facility register
          </Button>
        }
      />
    );
  }

  const { facility, obligor, app, letter } = row;
  const allCleared = row.cps.length > 0 && row.cleared === row.cps.length;
  const pending = facility.status === "Pending disbursement";
  const canRelease = isCad && pending && allCleared && !row.released && !pendingRelease;

  const doRelease = async () => {
    setResult(await requestRelease(row));
    setConfirm(false);
  };

  return (
    <Stack gap="large">
      <EntityHeader
        back={{ href: "/credit-admin/", label: "Facility register" }}
        linkComponent={Link}
        eyebrow={`${facility.product} · ${facilityClassOf[facility.product]}`}
        title={obligor?.name ?? facility.obligorId}
        subtitle={`${obligor?.type ?? ""} · ${facility.branch} branch`}
        identifier={facility.id}
        identifierLabel="Facility ID"
        status={{ status: facility.status, tones: facilityStatusTones }}
        facts={[
          { label: "Approved", value: money(facility.approvedAmount, facility.currency), mono: true },
          { label: "Outstanding", value: money(facility.outstanding, facility.currency), mono: true },
          { label: "Utilisation", value: pct(row.utilisation * 100), mono: true },
          { label: "Conditions", value: `${row.cleared}/${row.cps.length} cleared`, mono: true },
          { label: "Maturity", value: date(facility.maturityDate), mono: true },
        ]}
        actions={
          <>
            {canRaise ? (
              <Button as={Link} href={`/credit-admin/waivers/?facility=${facility.id}&new=1`} variant="tertiary">
                Raise waiver / deferral
              </Button>
            ) : null}
            {isCad && pending ? (
              <Button iconBefore={<Unlock aria-hidden className="size-4" />} disabled={!canRelease} onClick={() => setConfirm(true)}>
                {row.released ? "Released for disbursement" : pendingRelease ? "Release awaiting confirmation" : "Release for disbursement"}
              </Button>
            ) : null}
          </>
        }
      />

      <OutcomePopup value={result} map={outcomeCopy.okMessage()} />
      {pendingRelease ? <PendingOperationNotice instance={pendingRelease} title="Release for disbursement awaiting confirmation" /> : null}
      {pending ? (
        row.released ? (
          <Alert tone="success" title="File released for disbursement">
            Released by {row.released.byName} on {dateTime(row.released.at)}. Domestic Operations can now prepare the disbursement (maker-checker).{" "}
            <TextLink as={Link} href="/disbursement/">
              Open disbursement queue
            </TextLink>
          </Alert>
        ) : pendingRelease ? null : allCleared ? (
          <Alert tone="info" title="All conditions precedent are cleared">
            Credit Administration confirms the customer meets all approved terms and conditions, then releases the file to Domestic Operations for disbursement.
          </Alert>
        ) : (
          <Alert tone="warning" title={`${row.cps.length - row.cleared} condition(s) precedent outstanding`}>
            The file can&apos;t be released for disbursement until every condition is met, waived or deferred under an approved deferral.{" "}
            <Button size="small" variant="text" onClick={() => setTab("conditions")}>
              Review conditions
            </Button>
          </Alert>
        )
      ) : null}

      <Tabs
        value={tab}
        onValueChange={setTab}
        label="Facility record"
        items={[
          { id: "overview", label: "Overview", content: <OverviewTab row={row} onPrint={() => setPrintOpen(true)} /> },
          { id: "conditions", label: "Conditions precedent", badge: `${row.cleared}/${row.cps.length}`, content: <ConditionsTab row={row} editable={isCad} /> },
          { id: "covenants", label: "Covenants", content: <CovenantsTab row={row} /> },
          { id: "collateral", label: "Collateral", content: <CollateralTab row={row} /> },
          { id: "documents", label: "Documents", content: <DocumentsTab row={row} /> },
          { id: "activity", label: "Activity", content: <ActivityTab ids={[facility.id, app?.id, letter?.id].filter(Boolean) as string[]} /> },
        ]}
      />

      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        title="Release file for disbursement?"
        description="Confirms the customer meets all approved terms and conditions. The release is confirmed through the Operations workflow; the facility then moves to the Domestic Operations maker-checker queue."
        footer={
          <>
            <Button variant="tertiary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button iconBefore={<CheckCircle2 aria-hidden className="size-4" />} onClick={() => void doRelease()}>
              Request release
            </Button>
          </>
        }
      >
        <DescriptionList
          columns={2}
          items={[
            { label: "Facility", value: facility.id, mono: true },
            { label: "Approved amount", value: money(facility.approvedAmount, facility.currency), mono: true },
            { label: "Conditions", value: `${row.cleared} of ${row.cps.length} cleared` },
            { label: "Offer letter", value: letter ? `${letter.ref} (${letter.status})` : "—" },
          ]}
        />
      </Modal>

      <Modal open={printOpen} onOpenChange={setPrintOpen} size="large" title="Credit print-out" description="Minimum fields per CBN 3.8, auto-generated from the Risk Data Spine." footer={<Button iconBefore={<Printer aria-hidden className="size-4" />} onClick={() => window.print()}>Print</Button>}>
        <PrintOut row={row} />
      </Modal>
    </Stack>
  );
}

function usePrintOut(row: FacilityRow) {
  const sectors = useSectors();
  const collateral = useCollateral();
  const { facility, obligor } = row;
  const security = collateral.filter((c) => facility.collateralIds.includes(c.id)).reduce((s, c) => s + c.marketValue, 0);
  return [
    { label: "Account number", value: String(1_000_000_000 + (hash(facility.id) % 8_999_999_999)).slice(0, 10), mono: true },
    { label: "Customer name", value: obligor?.name ?? facility.obligorId },
    { label: "Facility type", value: facility.product },
    { label: "Date granted", value: date(facility.startDate), mono: true },
    { label: "Authorised limit", value: money(facility.approvedAmount, facility.currency), mono: true },
    { label: "Original expiry date", value: date(facility.maturityDate), mono: true },
    { label: "Account balance", value: money(facility.outstanding ? -facility.outstanding : 0, facility.currency), mono: true, hint: "Debit balance (CBA ledger)" },
    { label: "Last lodgement / credit operation", value: facility.outstanding > 0 ? date(addDaysIso(DEMO_NOW, -Math.ceil(rand(facility.id, "lodge") * 25) - (facility.dpd || 0))) : "—", mono: true },
    { label: "Sector / industry", value: sectors.find((s) => s.id === obligor?.sectorId)?.name ?? "—" },
    { label: "Security value", value: money(security), mono: true, hint: "Open market value of linked collateral" },
  ];
}

function PrintOut({ row }: { row: FacilityRow }) {
  const items = usePrintOut(row);
  return <DescriptionList columns={2} items={items} />;
}

function OverviewTab({ row, onPrint }: { row: FacilityRow; onPrint: () => void }) {
  const { facility, app, letter } = row;
  const printItems = usePrintOut(row);
  return (
    <Grid columns={{ base: 1, lg: 3 }} gap="medium">
      <div className="lg:col-span-2">
        <Stack gap="medium">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Terms</CardTitle>
                <CardDescription>Source: Loan Origination approval record reconciled to the CBA facility master.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <DescriptionList
                columns={3}
                items={[
                  { label: "Product", value: facility.product },
                  { label: "Currency", value: facility.currency },
                  { label: "Interest rate", value: `${facility.ratePct.toFixed(1)}% p.a.`, mono: true },
                  { label: "Tenor", value: `${facility.tenorMonths} months`, mono: true },
                  { label: "Start date", value: date(facility.startDate), mono: true },
                  { label: "Maturity", value: date(facility.maturityDate), mono: true },
                  { label: "Days past due", value: String(facility.dpd), mono: true },
                  { label: "CBN classification", status: facility.cbnClass, statusTones: cbnClassTones },
                  { label: "IFRS 9 stage", value: `Stage ${facility.stage}`, mono: true },
                  { label: "Request type", value: app?.requestType ?? "Existing book" },
                  { label: "Purpose", value: app?.purpose ?? "—", span: 2 },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Credit print-out</CardTitle>
                <CardDescription>Minimum fields per CBN 3.8 — auto-generated from the Risk Data Spine.</CardDescription>
              </div>
              <Button size="small" variant="tertiary" iconBefore={<Printer aria-hidden className="size-4" />} onClick={onPrint}>
                Print view
              </Button>
            </CardHeader>
            <CardContent>
              <DescriptionList columns={2} items={printItems} />
            </CardContent>
          </Card>
        </Stack>
      </div>
      <Stack gap="medium">
        <Card>
          <CardHeader>
            <CardTitle>Utilisation</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap="medium">
              <ProgressBar value={row.utilisation} showValue label="Outstanding ÷ approved" tone={row.utilisation > 0.95 ? "warning" : "brand"} />
              <KeyValueGrid
                columns={2}
                items={[
                  { label: "Disbursed", value: moneyShort(facility.outstanding, facility.currency), mono: true },
                  { label: "Undisbursed", value: moneyShort(row.undisbursed, facility.currency), mono: true },
                ]}
              />
            </Stack>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Linked records</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap="small">
              {app ? (
                <Button as={Link} href={`/origination/application/?id=${app.id}`} variant="tertiary" iconBefore={<FileText aria-hidden className="size-4" />}>
                  Application {app.id}
                </Button>
              ) : (
                <Text variant="small" tone="muted">
                  Booked before the platform went live — no origination record.
                </Text>
              )}
              {letter ? (
                <Button as={Link} href={`/offer-letters/letter/?id=${letter.id}`} variant="tertiary" iconBefore={<FileSignature aria-hidden className="size-4" />}>
                  Offer letter {letter.ref}
                </Button>
              ) : null}
              <Button as={Link} href="/disbursement/" variant="tertiary" iconBefore={<ShieldCheck aria-hidden className="size-4" />}>
                Disbursement queue
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Grid>
  );
}

function ConditionsTab({ row, editable }: { row: FacilityRow; editable: boolean }) {
  const waivers = useWaivers().filter((w) => w.facilityId === row.facility.id);
  const pending = row.facility.status === "Pending disbursement";
  const [error, setError] = useState<string | null>(null);

  const onToggle = (id: string, status: ChecklistStatus) => {
    void setConditionStatus(row, id, status).then((r) => setError(r.ok ? null : r.reason));
  };

  const items: ChecklistItem[] = row.cps.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.note ? `${c.text} — ${c.note}` : c.text,
    status: c.status,
    owner: c.category,
    dueDate: c.at ? `${c.byName} · ${date(c.at)}` : undefined,
    locked: !editable || !pending || c.status === "waived" || c.status === "deferred" || c.status === "breached",
  }));

  return (
    <Grid columns={{ base: 1, lg: 3 }} gap="medium">
      <div className="lg:col-span-2">
        {items.length === 0 ? (
          <EmptyState title="No conditions precedent" description="This facility has no conditions precedent recorded." />
        ) : (
          <ChecklistPanel
            title="Conditions precedent to drawdown"
            description={row.letter ? `From offer letter ${row.letter.ref} (library clauses).` : "Default conditions for the product from the library (facility booked before go-live)."}
            items={items}
            labels={{ owner: "Category", due: "Confirmed" }}
            // Library typing intersects the native <section> onToggle; cast to the checklist handler (library request).
            onToggle={(editable && pending ? onToggle : undefined) as ChecklistPanelProps["onToggle"]}
          />
        )}
      </div>
      <Stack gap="medium">
        {error ? (
          <Alert tone="danger" title="Not saved">
            {error}
          </Alert>
        ) : null}
        <Alert tone="info" title="What clears drawdown">

          A condition is cleared when it is <strong>met</strong>, <strong>waived</strong>, or <strong>deferred</strong> under an approved deferral. Waivers and deferrals are approved at the tier that approved the facility.
        </Alert>
        {!editable ? (
          <Text variant="small" tone="muted">
            Only Credit Administration can confirm conditions. You have view access.
          </Text>
        ) : !pending ? (
          <Text variant="small" tone="muted">
            The facility is {row.facility.status.toLowerCase()}; conditions are locked. Use a waiver or deferral request for changes.
          </Text>
        ) : null}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Waivers, deferrals & sanctions</CardTitle>
              <CardDescription>{waivers.length ? `${waivers.length} on this facility` : "None on this facility"}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Stack gap="small">
              {waivers.map((w) => (
                <div key={w.id} className="squircle flex flex-col gap-1 rounded-2xl bg-fg/5 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-fg">{w.id}</span>
                    <StatusBadge status={waiverStatus(w)} tones={waiverStatusTones} />
                  </div>
                  <Text variant="small">
                    {w.kind} — {w.conditionTitle}
                  </Text>
                  {w.expiryDate ? (
                    <Text variant="caption" tone="muted">
                      Expiry {date(w.expiryDate)}
                    </Text>
                  ) : null}
                </div>
              ))}
              <Button as={Link} href={`/credit-admin/waivers/?facility=${row.facility.id}`} size="small" variant="text">
                Open waivers register
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Grid>
  );
}

function CovenantsTab({ row }: { row: FacilityRow }) {
  const clauses = useClauses();
  const data = useMemo(() => covenantsFor(row, clauses), [row, clauses]);
  const columns: DataTableColumn<CovenantRow>[] = [
    { id: "title", header: "Covenant", accessor: "title", sortable: true, cell: (r) => <span className="font-medium text-fg">{r.title}</span> },
    { id: "category", header: "Type", accessor: "category" },
    { id: "source", header: "Source", accessor: "source" },
    { id: "status", header: "Status", accessor: "status", sortable: true, cell: (r) => <StatusBadge status={r.status} tones={covenantTones} /> },
    { id: "lastTested", header: "Last tested", accessor: (r) => r.lastTested ?? "", cell: (r) => <span className="font-mono text-sm">{r.lastTested ? date(r.lastTested) : "—"}</span> },
    { id: "nextTest", header: "Next test", accessor: "nextTest", cell: (r) => <span className="font-mono text-sm">{date(r.nextTest)}</span> },
  ];
  return (
    <Stack gap="medium">
      <DataTable label="Covenants" columns={columns} data={data} getRowId={(r) => r.id} paginate={false} emptyState={<EmptyState title="No covenants" description="No covenants are recorded for this facility." />} />
      <Text variant="caption" tone="muted">
        Covenants come from the offer letter (covenant library) and the special covenants tagged at origination. Ongoing monitoring sits in{" "}
        <TextLink as={Link} href="/monitoring/covenants/">
          Loan review → Covenants & inflows
        </TextLink>
        .
      </Text>
    </Stack>
  );
}

function CollateralTab({ row }: { row: FacilityRow }) {
  const all = useCollateral();
  const list = all.filter((c) => row.facility.collateralIds.includes(c.id));
  const total = list.reduce((s, c) => s + c.marketValue, 0);
  const columns: DataTableColumn<Collateral>[] = [
    { id: "id", header: "Collateral", accessor: "id", cell: (c) => <span className="font-mono text-sm font-semibold">{c.id}</span> },
    { id: "type", header: "Type", accessor: "type" },
    { id: "description", header: "Description", accessor: "description" },
    { id: "omv", header: "Market value", accessor: "marketValue", numeric: true, cell: (c) => moneyShort(c.marketValue) },
    { id: "fsv", header: "Forced-sale value", accessor: "forcedSaleValue", numeric: true, cell: (c) => moneyShort(c.forcedSaleValue) },
    { id: "perfection", header: "Perfection", accessor: "perfection", cell: (c) => <Badge tone={c.perfection === "Perfected" ? "success" : c.perfection === "Defective" ? "danger" : "warning"}>{c.perfection}</Badge> },
  ];
  return (
    <Stack gap="medium">
      <KeyValueGrid
        columns={3}
        items={[
          { label: "Linked items", value: String(list.length), mono: true },
          { label: "Total market value", value: moneyShort(total), mono: true },
          { label: "Security cover", value: row.facility.approvedAmount ? `${(total / row.facility.approvedAmount).toFixed(2)}x` : "—", mono: true, hint: "Market value ÷ approved amount" },
        ]}
      />
      <DataTable
        label="Linked collateral"
        columns={columns}
        data={list}
        getRowId={(c) => c.id}
        getRowHref={(c) => `/collateral/item/?id=${c.id}`}
        linkComponent={Link}
        paginate={false}
        emptyState={<EmptyState title="No collateral linked" description="This facility is unsecured or collateral has not been linked yet." />}
      />
    </Stack>
  );
}

function DocumentsTab({ row }: { row: FacilityRow }) {
  const documents = useDocuments();
  const users = useUsers();
  const ids = [row.facility.id, row.facility.obligorId, row.app?.id].filter(Boolean);
  const docs = documents.filter((d) => ids.includes(d.ownerId)).map((d) => toDocumentItem(d, users));
  return <DocumentList documents={docs} empty={<EmptyState icon={<FileText aria-hidden />} title="No documents on file" description="Documents uploaded at origination or to the credit file appear here." />} />;
}

function ActivityTab({ ids }: { ids: string[] }) {
  const audit = useAudit();
  const items = audit.filter((e) => ids.includes(e.entityId)).map(toActivityItem);
  return <AuditTrail items={items} emptyMessage="No activity recorded on this facility yet." />;
}

