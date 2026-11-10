"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addDays } from "date-fns";
import { FilePlus2, FileStack, RefreshCw, ScanSearch, Trash2 } from "lucide-react";
import {
  Alert,
  ApprovalTimeline,
  Button,
  Card,
  CardContent,
  Checkbox,
  DataTable,
  DescriptionList,
  EmptyState,
  Field,
  FileUpload,
  Gauge,
  Grid,
  IconButton,
  Input,
  KeyValueGrid,
  ProgressBar,
  RadioGroup,
  SearchField,
  Select,
  Stack,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  useToast,
  Wizard,
  type DataTableColumn,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { useApplications, useCollateral, useDbActions, useFacilities, useObligors, useSectors, useUsers } from "@/lib/data/hooks";
import { branches } from "@/lib/data/seed";
import { newId } from "@/lib/data/store";
import type { Application, Collateral, CollateralType, DocumentRecord, Obligor, ObligorType, ProductType } from "@/lib/data/types";
import { roleById } from "@/lib/rbac/roles";
import { money, moneyShort, pct } from "@/lib/format";
import { bureauAdverse, bureauReports, extractedFinancials, reconciliation, rng, useOriginationStore } from "../data";
import { buildChainFor, copBand, finalAuthority, lendingValue, limitGate, runEngine, tagCovenants } from "../logic";
import { fastTrackVariants, haircutFor, inGroup, productOptions, requiredKinds, slaDays, TENANT_PARAM_NOTE } from "../params";
import { getRule } from "@/lib/platform/rules";
import { createApplication, submitApplication } from "../actions";
import { toApprovalTiers } from "../view-models";
import { documentKinds } from "../application/documents-tab";
import { perfectionTones } from "../application/collateral-tab";
import { useMe } from "../use-me";
import { useRulesVersion, useStepUpThreshold } from "../use-params";

type UploadItem = { id: string; name: string; sizeKb: number; kind: DocumentRecord["kind"]; progress: number };
type NewCollateral = { id: string; type: CollateralType; description: string; marketValue: string };
type NewObligorForm = { name: string; type: ObligorType; sectorId: string; rcNumber: string; branch: string; state: string; declaredTurnover: string };

const obligorTypes: ObligorType[] = ["Corporate", "Commercial", "SME", "Retail", "Public sector"];
const requestTypes: Application["requestType"][] = ["New", "Renewal", "Enhancement", "Restructure", "Waiver"];
const states = ["Lagos", "FCT", "Rivers", "Kano", "Oyo", "Enugu", "Kaduna", "Ogun", "Delta", "Anambra"];
const collateralTypeOptions: CollateralType[] = ["Legal mortgage", "Equitable mortgage", "Debenture", "Quoted shares", "Cash / lien on deposit", "Vehicle", "Equipment", "Domiciliation of proceeds", "Personal guarantee", "Corporate guarantee", "Insurance policy"];
const toNumber = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;

/** Next sequential application reference, e.g. APP-2026037. */
function nextApplicationId(ids: string[]): string {
  const max = ids.reduce((m, id) => Math.max(m, Number(/^APP-(\d+)$/.exec(id)?.[1] ?? 0)), 2026000);
  return `APP-${max + 1}`;
}

function guessKind(name: string): DocumentRecord["kind"] {
  const n = name.toLowerCase();
  if (/audit|afs|financial/.test(n)) return "Audited financials";
  if (/management|mgt/.test(n)) return "Management accounts";
  if (/statement|bank/.test(n)) return "Bank statement";
  if (/kyc|cac|id|passport|utility/.test(n)) return "KYC";
  if (/board|resolution/.test(n)) return "Board resolution";
  if (/title|c of o|deed/.test(n)) return "Title document";
  if (/valuation/.test(n)) return "Valuation report";
  return "Other";
}

export function NewApplicationPage() {
  const canEdit = useCan("origination", "edit");
  const { user: me, roleId } = useMe();
  useRulesVersion();
  const allowed = canEdit && inGroup("initiators", roleId);
  return (
    <ModulePage module="origination" description="Initiate a credit request: obligor, facility, documents with OCR, financial-statement validation, bureau / CRMS checks, collateral and the chart-flow route.">
      {allowed ? (
        <NewApplicationWizard meId={me.id} />
      ) : (
        <EmptyState
          icon={<FilePlus2 aria-hidden />}
          title="Only the Account Officer or BDM initiates applications"
          description={`The ${roleId ? roleById[roleId].name : "current role"} reviews and decides on requests but doesn't initiate them (PRD §6.1.1). Switch role from the user menu to try it.`}
          action={<Button as={Link} href="/origination/">Back to applications</Button>}
        />
      )}
    </ModulePage>
  );
}

function NewApplicationWizard({ meId }: { meId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const db = useDbActions();
  const patchExtra = useOriginationStore((s) => s.patch);
  const { user: me, roleId } = useMe();
  const obligors = useObligors();
  const sectors = useSectors();
  const users = useUsers();
  const facilities = useFacilities();
  const collateralAll = useCollateral();
  const applications = useApplications();
  const threshold = useStepUpThreshold();
  useRulesVersion();

  // ---- state
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [query, setQuery] = useState("");
  const [obligorId, setObligorId] = useState<string>();
  const [form, setForm] = useState<NewObligorForm>({ name: "", type: "SME", sectorId: "SEC-COM", rcNumber: "", branch: branches[0]!, state: "Lagos", declaredTurnover: "" });
  const [product, setProduct] = useState<ProductType>("Term loan");
  const [variant, setVariant] = useState("");
  const [amount, setAmount] = useState("");
  const [tenor, setTenor] = useState(() => String(getRule<number>("origination.defaultTenorMonths")));
  const [purpose, setPurpose] = useState("");
  const [requestType, setRequestType] = useState<Application["requestType"]>("New");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [picked, setPicked] = useState<File[]>([]);
  const [bureauState, setBureauState] = useState<"idle" | "running" | "done">("idle");
  const [bureauProgress, setBureauProgress] = useState(0);
  const [copExplanation, setCopExplanation] = useState("");
  const [collateralIds, setCollateralIds] = useState<string[]>([]);
  const [newCollateral, setNewCollateral] = useState<NewCollateral[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const draftIdRef = useRef<string | null>(null);

  // ---- derived obligor (existing, or a provisional record for a new customer)
  const existing = obligors.find((o) => o.id === obligorId);
  const provisional: Obligor | undefined = useMemo(() => {
    if (mode === "existing") return existing;
    const declared = toNumber(form.declaredTurnover);
    if (!form.name.trim() || !declared) return undefined;
    const r = rng(`new-${form.name}`);
    const score = () => Number(r.range(4.5, 7.5).toFixed(1));
    return {
      id: `NEW-${form.name.trim()}`,
      name: form.name.trim(),
      type: form.type,
      sectorId: form.sectorId,
      rcNumber: form.type === "Retail" ? undefined : form.rcNumber || undefined,
      relationshipManagerId: meId,
      branch: form.branch,
      state: form.state,
      customerSince: new Date().toISOString(),
      riskGrade: 5,
      rar: { internal: score(), industry: score(), comparative: score(), macro: score() },
      rarUpdatedAt: new Date().toISOString(),
      declaredTurnover: declared,
      verifiedTurnover: Math.round(declared * r.range(0.62, 1.02)),
      watchlist: false,
    };
  }, [mode, existing, form, meId]);
  const obligor = provisional;
  const sector = sectors.find((s) => s.id === obligor?.sectorId);

  const amountN = toNumber(amount);
  const tenorN = toNumber(tenor);
  const variants = fastTrackVariants().filter((v) => v.product === product);
  const flow: Application["flow"] = variant ? "Fast-Track" : "Standard";
  const chain = useMemo(() => buildChainFor(flow, amountN, users), [flow, amountN, users]);

  // ---- simulated OCR progress
  const processing = uploads.some((u) => u.progress < 100);
  useEffect(() => {
    if (!processing) return;
    const t = window.setInterval(() => setUploads((list) => list.map((u) => (u.progress < 100 ? { ...u, progress: Math.min(100, u.progress + 9 + (u.name.length % 7)) } : u))), 260);
    return () => window.clearInterval(t);
  }, [processing]);

  const addFiles = (files: { name: string; size: number }[]) =>
    setUploads((list) => [...list, ...files.map((f) => ({ id: newId("UPL"), name: f.name, sizeKb: Math.max(1, Math.round(f.size / 1024)), kind: guessKind(f.name), progress: 0 }))]);
  const addSamples = () =>
    addFiles([
      { name: "Audited financial statements FY2025.pdf", size: 2_480_000 },
      { name: "Bank statements Jan–Dec 2025 (CBA + other banks).pdf", size: 1_120_000 },
      { name: "KYC pack — CAC documents and directors' IDs.pdf", size: 860_000 },
      ...(form.type !== "Retail" || mode === "existing" ? [{ name: "Board resolution — borrowing approval.pdf", size: 210_000 }] : []),
      { name: "Management accounts Q3 2026.xlsx", size: 340_000 },
    ]);

  const required = requiredKinds(obligor?.type ?? "SME");
  const missingKinds = required.filter((k) => !uploads.some((u) => u.kind === k));
  const afsReady = uploads.some((u) => u.kind === "Audited financials" && u.progress >= 100);
  const statementsReady = uploads.some((u) => u.kind === "Bank statement" && u.progress >= 100);

  // ---- validation figures
  const rec = obligor ? reconciliation(obligor) : undefined;
  const cop = rec && afsReady && statementsReady ? Number((rec.verified / rec.declared).toFixed(2)) : undefined;
  const band = copBand(cop);
  const fields = obligor ? extractedFinancials(obligor) : [];

  // ---- bureau
  const runBureau = () => {
    setBureauState("running");
    setBureauProgress(0);
    let p = 0;
    const t = window.setInterval(() => {
      p += 0.12;
      setBureauProgress(Math.min(1, p));
      if (p >= 1) {
        window.clearInterval(t);
        setBureauState("done");
      }
    }, 180);
  };
  const reports = obligor && bureauState === "done" ? bureauReports(obligor, facilities) : [];

  // ---- collateral
  const obligorCollateral = collateralAll.filter((c) => c.obligorId === obligor?.id);
  const chosen = obligorCollateral.filter((c) => collateralIds.includes(c.id));
  const newCollValue = newCollateral.reduce((s, c) => s + lendingValue({ marketValue: toNumber(c.marketValue), haircutPct: haircutFor(c.type) }), 0);
  const lendingTotal = chosen.reduce((s, c) => s + lendingValue(c), 0) + newCollValue;
  const coverage = amountN ? lendingTotal / amountN : 0;

  // ---- gate + engine preview
  const gate = obligor ? limitGate({ product, amount: amountN, obligorId: obligor.id }, obligor, facilities, obligors, sectors) : undefined;
  const engine = obligor && gate ? runEngine({ obligor, copRatio: cop, copExplained: copExplanation.trim().length >= getRule<number>("origination.cop.explanationMinLength"), limitGate: gate.result, bureauAdverse: bureauAdverse(reports), coverage }) : undefined;

  // ---- persist
  const persist = (stage: Application["stage"]) => {
    if (!obligor) return undefined;
    const now = new Date();
    let obligorRecord = obligor;
    if (mode === "new") {
      obligorRecord = { ...obligor, id: newId("OBL") };
      db.upsert("obligors", obligorRecord);
      db.log({ actorId: me.id, actorName: me.name, roleId: roleId!, action: "Created obligor (new customer)", entityType: "Obligor", entityId: obligorRecord.id, after: obligorRecord.name });
    }
    const appId = draftIdRef.current ?? nextApplicationId(applications.map((a) => a.id));
    draftIdRef.current = appId;
    const createdColl: Collateral[] = newCollateral
      .filter((c) => toNumber(c.marketValue) > 0)
      .map((c) => ({
        id: newId("COL"),
        obligorId: obligorRecord.id,
        type: c.type,
        description: c.description || c.type,
        marketValue: toNumber(c.marketValue),
        forcedSaleValue: Math.round((toNumber(c.marketValue) * getRule<number>("origination.collateral.forcedSalePct")) / 100),
        haircutPct: haircutFor(c.type),
        valuedAt: now.toISOString(),
        valuer: "Pending independent valuation",
        nextRevaluation: addDays(now, getRule<number>("origination.collateral.revaluationDays")).toISOString(),
        perfection: "Search in progress",
        facilityIds: [],
      }));
    createdColl.forEach((c) => db.upsert("collateral", c));
    const docs: DocumentRecord[] = uploads.map((u) => ({
      id: newId("DOC"),
      ownerType: "application",
      ownerId: appId,
      name: u.name,
      kind: u.kind,
      sizeKb: u.sizeKb,
      version: 1,
      uploadedById: me.id,
      uploadedAt: now.toISOString(),
      status: u.progress >= 100 ? "Extracted" : "Processing OCR",
    }));
    docs.forEach((d) => db.upsert("documents", d));
    const engineOut = engine;
    const app: Application = {
      id: appId,
      obligorId: obligorRecord.id,
      product,
      amount: amountN,
      tenorMonths: tenorN || getRule<number>("origination.defaultTenorMonths"),
      purpose: purpose.trim() || "To be confirmed",
      flow,
      requestType,
      stage,
      createdById: me.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      slaDueAt: addDays(now, slaDays(flow)).toISOString(),
      approvals: chain,
      documentIds: docs.map((d) => d.id),
      collateralIds: [...collateralIds, ...createdColl.map((c) => c.id)],
      copRatio: cop,
      recommendation: undefined,
      covenants: engineOut ? tagCovenants({ product, obligor: obligorRecord, tenorMonths: tenorN, collateral: [...chosen, ...createdColl], position: engineOut.position, variant }).map((k) => k.text) : [],
      bureauChecked: bureauState === "done",
      crmsChecked: bureauState === "done",
      limitGate: gate && amountN ? gate.result : "Not checked",
    };
    db.upsert("applications", app);
    patchExtra(appId, { variant: variant || undefined, copExplanation: copExplanation.trim() || undefined, bureauRunAt: bureauState === "done" ? now.toISOString() : undefined });
    db.log({ actorId: me.id, actorName: me.name, roleId: roleId!, action: stage === "Draft" ? "Saved application draft" : "Initiated and submitted application", entityType: "Application", entityId: appId, after: `${money(amountN)} ${product} · ${flow}` });
    return appId;
  };

  // ---- steps
  const obligorColumns: DataTableColumn<Obligor>[] = [
    { id: "name", header: "Obligor", accessor: "name", sortable: true },
    { id: "id", header: "ID", accessor: "id", cell: (o) => <span className="font-mono">{o.id}</span> },
    { id: "type", header: "Type", accessor: "type" },
    { id: "sector", header: "Sector", accessor: (o) => sectors.find((s) => s.id === o.sectorId)?.name ?? "" },
    { id: "branch", header: "Branch", accessor: "branch" },
    { id: "grade", header: "Grade", accessor: "riskGrade", numeric: true },
  ];
  const q = query.trim().toLowerCase();
  const matches = obligors.filter((o) => !q || o.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q) || (o.rcNumber ?? "").toLowerCase().includes(q));

  const obligorStep = (
    <Stack gap="large">
      <RadioGroup
        label="Customer"
        orientation="horizontal"
        value={mode}
        onChange={(v) => setMode(v as "existing" | "new")}
        options={[
          { value: "existing", label: "Existing obligor" },
          { value: "new", label: "New customer" },
        ]}
      />
      {mode === "existing" ? (
        <Stack gap="medium">
          {existing ? (
            <Alert tone="success" title={`Selected: ${existing.name}`}>
              {existing.id} · {existing.type} · {sectors.find((s) => s.id === existing.sectorId)?.name} · risk grade {existing.riskGrade}/10{existing.watchlist ? " · on watchlist" : ""}
            </Alert>
          ) : null}
          <SearchField label="Search obligors" placeholder="Search by name, obligor ID or RC number" value={query} onValueChange={setQuery} />
          <DataTable
            label="Obligors"
            columns={obligorColumns}
            data={matches}
            getRowId={(o) => o.id}
            onRowClick={(o) => setObligorId(o.id)}
            defaultPageSize={5}
            pageSizeOptions={[]}
            rowProps={(o: Obligor) => (o.id === obligorId ? { "aria-selected": true, className: "bg-accent-50" } : {})}
          />
        </Stack>
      ) : (
        <Grid columns={{ base: 1, md: 2 }} gap="medium">
          <Field label="Legal name" htmlFor="ob-name" required>
            <Input id="ob-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Obligor type" htmlFor="ob-type" required>
            <Select id="ob-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as ObligorType })} options={obligorTypes.map((t) => ({ value: t, label: t }))} />
          </Field>
          <Field label="Sector (CBN classification)" htmlFor="ob-sector" required>
            <Select id="ob-sector" value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })} options={sectors.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
          <Field label={form.type === "Retail" ? "BVN" : "RC number"} htmlFor="ob-rc" optional>
            <Input id="ob-rc" value={form.rcNumber} onChange={(e) => setForm({ ...form, rcNumber: e.target.value })} />
          </Field>
          <Field label="Branch" htmlFor="ob-branch">
            <Select id="ob-branch" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} options={branches.map((b) => ({ value: b, label: b }))} />
          </Field>
          <Field label="State" htmlFor="ob-state">
            <Select id="ob-state" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} options={states.map((b) => ({ value: b, label: b }))} />
          </Field>
          <Field label="Declared annual turnover" htmlFor="ob-turnover" required description={toNumber(form.declaredTurnover) ? `${moneyShort(toNumber(form.declaredTurnover))} — confirmed against the audited financials at OCR` : "As stated in the latest audited financial statements"}>
            <Input id="ob-turnover" inputMode="numeric" prefix="₦" value={form.declaredTurnover} onChange={(e) => setForm({ ...form, declaredTurnover: e.target.value })} />
          </Field>
        </Grid>
      )}
    </Stack>
  );

  const facilityStep = (
    <Grid columns={{ base: 1, md: 2 }} gap="medium">
      <Field label="Product" htmlFor="f-product" required>
        <Select
          id="f-product"
          value={product}
          onChange={(e) => {
            setProduct(e.target.value as ProductType);
            setVariant("");
          }}
          options={productOptions().map((p) => ({ value: p, label: p }))}
        />
      </Field>
      <Field label="Fast-Track product" htmlFor="f-variant" description={variants.length ? "Lower-risk standardised products run on the Fast-Track chart-flow (PRD §6.1.3)." : "Not available for this product — Standard chart-flow."}>
        <Select id="f-variant" value={variant} disabled={!variants.length} onChange={(e) => setVariant(e.target.value)} options={[{ value: "", label: "None — Standard credit" }, ...variants.map((v) => ({ value: v.id, label: v.label }))]} />
      </Field>
      <Field label="Amount requested" htmlFor="f-amount" required description={amountN ? `${money(amountN)} (${moneyShort(amountN)})` : undefined}>
        <Input id="f-amount" inputMode="numeric" prefix="₦" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Tenor" htmlFor="f-tenor" required>
        <Input id="f-tenor" inputMode="numeric" suffix="months" value={tenor} onChange={(e) => setTenor(e.target.value)} />
      </Field>
      <Field label="Request type" htmlFor="f-type">
        <Select id="f-type" value={requestType} onChange={(e) => setRequestType(e.target.value as Application["requestType"])} options={requestTypes.map((t) => ({ value: t, label: t }))} />
      </Field>
      <Field label="Chart-flow" htmlFor="f-flow" description="Set by the product — configured in Admin → Rules & parameters.">
        <div id="f-flow">
          <StatusBadge status={flow} tones={{ "Fast-Track": "accent", Standard: "neutral" }} />
        </div>
      </Field>
      <div className="md:col-span-2">
        <Field label="Purpose" htmlFor="f-purpose" required description="As stated in the customer's request letter.">
          <Textarea id="f-purpose" rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
      </div>
    </Grid>
  );

  const documentsStep = (
    <Stack gap="large">
      <Grid columns={{ base: 1, lg: 3 }} gap="large">
        <div className="lg:col-span-2">
          <Stack gap="medium">
            <FileUpload accept={getRule<string>("origination.docs.acceptedTypes")} multiple maxSizeMb={getRule<number>("origination.docs.maxUploadMb")} files={picked} onFilesChange={setPicked} />
            <Stack direction="horizontal" gap="small" wrap>
              <Button
                disabled={!picked.length}
                onClick={() => {
                  addFiles(picked);
                  setPicked([]);
                }}
              >
                Upload {picked.length ? `${picked.length} file(s)` : ""}
              </Button>
              <Button variant="tertiary" iconBefore={<FileStack aria-hidden />} onClick={addSamples}>
                Use sample customer pack
              </Button>
            </Stack>
          </Stack>
        </div>
        <Card variant="filled">
          <CardContent>
            <Stack gap="small">
              <Text variant="eyebrow">Required for a {(obligor?.type ?? "SME").toLowerCase()} obligor</Text>
              {required.map((k) => (
                <Stack key={k} direction="horizontal" justify="between" gap="small">
                  <Text variant="small">{k}</Text>
                  <StatusBadge status={uploads.some((u) => u.kind === k && u.progress >= 100) ? "Extracted" : uploads.some((u) => u.kind === k) ? "Processing" : "Missing"} tones={{ Extracted: "success", Processing: "info", Missing: "warning" }} />
                </Stack>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Grid>
      {uploads.length ? (
        <div className="relative overflow-x-auto">
          {/* `relative`: containing block for the header's sr-only (absolute) label, so it is clipped instead of widening the page on phones. */}
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Document</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>OCR extraction</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Remove</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {uploads.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Text variant="small">{u.name}</Text>
                    <Text variant="caption" tone="muted">
                      {u.sizeKb.toLocaleString()} KB · v1
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Select aria-label={`Document type for ${u.name}`} size="small" value={u.kind} onChange={(e) => setUploads((l) => l.map((x) => (x.id === u.id ? { ...x, kind: e.target.value as DocumentRecord["kind"] } : x)))} options={documentKinds.map((k) => ({ value: k, label: k }))} />
                  </TableCell>
                  <TableCell>{u.progress >= 100 ? <StatusBadge status="Extracted" tones={{ Extracted: "success" }} /> : <ProgressBar value={u.progress / 100} size="small" label="Processing OCR" showValue />}</TableCell>
                  <TableCell>
                    <IconButton label={`Remove ${u.name}`} variant="text" icon={<Trash2 aria-hidden />} onClick={() => setUploads((l) => l.filter((x) => x.id !== u.id))} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={<ScanSearch aria-hidden />} title="No documents yet" description="Upload the audited financials, bank statements, KYC and board resolution. OCR parses each into structured fields (PRD §5.4)." />
      )}
      {afsReady && obligor ? (
        <Stack gap="small">
          <Text variant="eyebrow">Extracted from the audited financial statements</Text>
          <KeyValueGrid columns={4} items={fields.slice(0, 4).map((f) => ({ label: f.label, value: moneyShort(f.value), mono: true, hint: `OCR ${pct(f.confidence * 100)} · ${f.source}` }))} />
        </Stack>
      ) : null}
    </Stack>
  );

  const validationStep =
    !obligor || !rec ? null : (
      <Stack gap="large">
        {cop === undefined ? (
          <Alert tone="warning" title="Statements still needed">Upload and extract the audited financials and bank statements to compute the COP Ratio.</Alert>
        ) : (
          <Grid columns={{ base: 1, lg: 2 }} gap="large">
            <Stack gap="medium">
              <Gauge value={cop} min={0} max={getRule<number>("origination.cop.gaugeMax")} label="COP Ratio" valueFormatter={(v) => v.toFixed(2)} bands={[{ to: getRule<number>("origination.cop.mediumBand"), tone: "danger" }, { to: getRule<number>("origination.cop.highBand"), tone: "warning" }, { to: getRule<number>("origination.cop.gaugeMax"), tone: "success" }]} />
              {band ? (
                <Stack direction="horizontal" justify="center">
                  <StatusBadge status={band.label} tones={{ [band.label]: band.tone }} />
                </Stack>
              ) : null}
            </Stack>
            <DescriptionList
              columns={1}
              layout="inline"
              items={[
                { label: "CBA credits", value: money(rec.cbaGross), mono: true },
                { label: `Other banks (${rec.otherBanks.length})`, value: money(rec.otherBankGross), mono: true, hint: rec.otherBanks.map((b) => b.name).join(", ") },
                { label: "Less inter-branch / suspense", value: `−${money(rec.interBranchSuspense)}`, mono: true },
                { label: "Less in-and-out entries", value: `−${money(rec.inAndOut)}`, mono: true },
                { label: "Less reversals", value: `−${money(rec.reversals)}`, mono: true },
                { label: "Verified turnover", value: money(rec.verified), mono: true },
                { label: "Declared turnover (AFS)", value: money(rec.declared), mono: true },
                { label: "COP Ratio", value: `${cop.toFixed(2)} — ${band?.weight}`, mono: true },
              ]}
            />
          </Grid>
        )}
        {band?.requiresExplanation ? (
          <Field label="Customer explanation (required for Low confidence)" htmlFor="cop-exp" required description="The Credit Analyst confirms this during analysis (PRD §6.1.4).">
            <Textarea id="cop-exp" rows={3} value={copExplanation} onChange={(e) => setCopExplanation(e.target.value)} />
          </Field>
        ) : null}
        <Text variant="caption" tone="muted">
          Bands: ≥ {getRule<number>("origination.cop.highBand")} High, {getRule<number>("origination.cop.mediumBand")}–{getRule<number>("origination.cop.highBand")} Medium, below {getRule<number>("origination.cop.mediumBand")} Low — PRD §6.1.4 example banding (business rules).
        </Text>
      </Stack>
    );

  const checksStep = (
    <Stack gap="large">
      <Stack direction="horizontal" gap="medium" align="center" wrap>
        <Button iconBefore={<RefreshCw aria-hidden />} loading={bureauState === "running"} onClick={runBureau} disabled={!obligor}>
          {bureauState === "done" ? "Re-run checks" : "Run bureau & CRMS checks"}
        </Button>
        <Text variant="small" tone="muted">
          Two licensed bureaux plus a CBN CRMS search — mandatory before approval (PRD §5.2). Simulated connector.
        </Text>
      </Stack>
      {bureauState === "running" ? <ProgressBar value={bureauProgress} label="Querying CRC, FirstCentral and CRMS" showValue /> : null}
      {bureauState === "done" ? (
        <Stack gap="medium">
          {bureauAdverse(reports) ? <Alert tone="danger" title="Adverse finding">A non-performing facility is reported at another institution.</Alert> : <Alert tone="success" title="No adverse findings">All reported facilities are performing.</Alert>}
          <Grid columns={{ base: 1, md: 3 }} gap="medium">
            {reports.map((b) => (
              <KeyValueGrid key={b.source} columns={2} items={[{ label: b.source, value: b.score ? String(b.score) : `${b.lines.length} lines`, mono: true }, { label: "Reference", value: b.reference, mono: true }]} />
            ))}
          </Grid>
          <div className="relative overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Institution</TableHeaderCell>
                  <TableHeaderCell>Facility</TableHeaderCell>
                  <TableHeaderCell numeric>Approved</TableHeaderCell>
                  <TableHeaderCell numeric>Outstanding</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(reports[2]?.lines ?? []).map((l, i) => (
                  <TableRow key={i}>
                    <TableCell>{l.institution}</TableCell>
                    <TableCell>{l.facilityType}</TableCell>
                    <TableCell numeric>{moneyShort(l.approved)}</TableCell>
                    <TableCell numeric>{moneyShort(l.outstanding)}</TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} tones={{ Performing: "success", "Non-performing": "danger" }} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Stack>
      ) : null}
    </Stack>
  );

  const collateralStep = (
    <Stack gap="large">
      {obligorCollateral.length ? (
        <Stack gap="small">
          <Text variant="eyebrow">Existing security held for this obligor</Text>
          {obligorCollateral.map((c) => (
            <Stack key={c.id} direction="horizontal" gap="small" align="start">
              <Checkbox
                id={`col-${c.id}`}
                checked={collateralIds.includes(c.id)}
                onChange={(e) => setCollateralIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                label={`${c.type} — ${c.description}`}
                description={`${c.id} · market value ${moneyShort(c.marketValue)} · haircut ${c.haircutPct}% · lending value ${moneyShort(lendingValue(c))}`}
              />
              <StatusBadge status={c.perfection} tones={perfectionTones} />
            </Stack>
          ))}
        </Stack>
      ) : (
        <Text tone="muted">No security on file for this obligor.</Text>
      )}
      <Stack gap="small">
        <Text variant="eyebrow">New collateral offered</Text>
        {newCollateral.map((c, i) => (
          <Grid key={c.id} columns={{ base: 1, md: 3 }} gap="small">
            <Select aria-label="Collateral type" value={c.type} onChange={(e) => setNewCollateral((l) => l.map((x, j) => (j === i ? { ...x, type: e.target.value as CollateralType } : x)))} options={collateralTypeOptions.map((t) => ({ value: t, label: `${t} (haircut ${haircutFor(t)}%)` }))} />
            <Input aria-label="Description" placeholder="Description / location" value={c.description} onChange={(e) => setNewCollateral((l) => l.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
            <Stack direction="horizontal" gap="small">
              <Input aria-label="Market value" prefix="₦" inputMode="numeric" placeholder="Market value" value={c.marketValue} onChange={(e) => setNewCollateral((l) => l.map((x, j) => (j === i ? { ...x, marketValue: e.target.value } : x)))} />
              <IconButton label="Remove collateral" variant="text" icon={<Trash2 aria-hidden />} onClick={() => setNewCollateral((l) => l.filter((_, j) => j !== i))} />
            </Stack>
          </Grid>
        ))}
        <div>
          <Button variant="tertiary" onClick={() => setNewCollateral((l) => [...l, { id: newId("NC"), type: "Legal mortgage", description: "", marketValue: "" }])}>
            Add collateral
          </Button>
        </div>
        {newCollateral.length ? <Text variant="caption" tone="muted">New collateral is sent to Legal for search in parallel with the BDM review (PRD §6.1.1 step 2). Haircuts: {TENANT_PARAM_NOTE.toLowerCase()}.</Text> : null}
      </Stack>
      <KeyValueGrid
        columns={3}
        items={[
          { label: "Lending value", value: moneyShort(lendingTotal), mono: true, hint: "Market value less haircut" },
          { label: "Requested", value: moneyShort(amountN), mono: true },
          { label: "Security cover", value: pct(coverage * 100, 0), mono: true, hint: coverage >= 1 ? "Fully secured" : "Partly secured" },
        ]}
      />
    </Stack>
  );

  const routingStep = (
    <Stack gap="large">
      <KeyValueGrid
        columns={4}
        items={[
          { label: "Chart-flow", value: flow, hint: variant ? fastTrackVariants().find((v) => v.id === variant)?.label : "Standard credit" },
          { label: "Final authority", value: finalAuthority(chain), hint: `${chain.length} approval steps` },
          { label: "SLA target", value: `${slaDays(flow)} days`, hint: TENANT_PARAM_NOTE },
          { label: "Step-up authentication", value: amountN > threshold ? "Required" : "Not required", hint: `Above ${moneyShort(threshold)}` },
        ]}
      />
      {gate ? (
        <Alert tone={gate.result === "Within limit" ? "success" : "danger"} title={`Portfolio-limit gate: ${gate.result}`}>
          Single obligor {pct(gate.solUtilisation * 100)} of limit · {sector?.name ?? "Sector"} {pct(gate.sectorUtilisation * 100)} of limit.
          {gate.result !== "Within limit" ? " The request will be routed to the CRO / Board for an informed exception decision (PRD §6.1.5)." : ""}
        </Alert>
      ) : null}
      <ApprovalTimeline tiers={toApprovalTiers(chain, users)} />
    </Stack>
  );

  const summary = obligor ? (
    <Stack gap="large">
      <DescriptionList
        columns={3}
        items={[
          { label: "Obligor", value: `${obligor.name}${mode === "new" ? " (new customer)" : ""}` },
          { label: "Sector", value: sector?.name },
          { label: "Product", value: `${product}${variant ? ` · ${fastTrackVariants().find((v) => v.id === variant)?.label}` : ""}` },
          { label: "Amount", value: money(amountN), mono: true },
          { label: "Tenor", value: `${tenorN} months`, mono: true },
          { label: "Request type", value: requestType },
          { label: "Purpose", value: purpose, span: 3 },
          { label: "Documents", value: `${uploads.length} uploaded, ${uploads.filter((u) => u.progress >= 100).length} extracted` },
          { label: "COP Ratio", value: cop !== undefined ? `${cop.toFixed(2)} — ${band?.label}` : undefined },
          { label: "Bureau & CRMS", value: bureauState === "done" ? "Completed" : "Not run" },
          { label: "Security cover", value: pct(coverage * 100, 0), mono: true },
          { label: "Chart-flow", value: `${flow} → ${finalAuthority(chain)}` },
          { label: "Limit gate", value: gate?.result },
        ]}
      />
      {engine ? (
        <Alert tone="info" title={`Indicative system recommendation: ${engine.recommendation === "Approve" ? "Proceed" : engine.recommendation === "Approve with conditions" ? "Proceed with conditions" : engine.recommendation}`}>
          The Credit Analyst reviews and adopts or overrides the recommendation during analysis (PRD §6.1.5).
        </Alert>
      ) : null}
    </Stack>
  ) : null;

  return (
    <Wizard
      steps={[
        {
          id: "obligor",
          title: "Obligor",
          description: "Existing customer or new",
          content: obligorStep,
          validate: () => (obligor ? true : mode === "existing" ? "Select an obligor to continue." : "Enter the legal name and declared turnover."),
        },
        {
          id: "facility",
          title: "Facility request",
          description: "Product, amount, tenor, purpose",
          content: facilityStep,
          validate: () => (!amountN ? "Enter the amount requested." : !tenorN ? "Enter the tenor in months." : purpose.trim().length < 5 ? "Describe the purpose of the facility." : true),
        },
        {
          id: "documents",
          title: "Documents",
          description: "Upload with OCR extraction",
          content: documentsStep,
          validate: () => (missingKinds.length ? `Still required: ${missingKinds.join(", ")}.` : processing ? "Wait for OCR extraction to finish." : true),
        },
        {
          id: "validation",
          title: "Financial validation",
          description: "COP Ratio confidence",
          content: validationStep,
          validate: () => (cop === undefined ? "The COP Ratio needs extracted financials and statements." : band?.requiresExplanation && copExplanation.trim().length < getRule<number>("origination.cop.explanationMinLength") ? "Low confidence — document the customer's explanation." : true),
        },
        {
          id: "checks",
          title: "Bureau & CRMS",
          description: "Mandatory pre-approval gate",
          content: checksStep,
          validate: () => (bureauState === "done" ? true : "Run the bureau and CRMS checks — required before approval (CBN 3.7)."),
        },
        { id: "collateral", title: "Collateral", description: "Security offered", optional: true, content: collateralStep },
        { id: "routing", title: "Routing preview", description: "Chart-flow and approval chain", content: routingStep },
      ]}
      summary={summary}
      summaryTitle="Review & submit"
      submitting={submitting}
      labels={{ submit: "Submit application" }}
      onSaveDraft={() => {
        if (!obligor) {
          toast({ title: "Choose an obligor first", description: "A draft needs at least the obligor.", tone: "warning" });
          return;
        }
        void createApplication(() => persist("Draft")).then((res) => {
          if (!res.ok) { toast({ title: "Draft not saved", description: res.reason, tone: "danger" }); return; }
          toast({ title: "Draft saved", description: `${res.appId} is in your queue as a draft.`, tone: "success" });
          router.push(`/origination/application/?id=${res.appId}`);
        });
      }}
      onSubmit={async () => {
        setSubmitting(true);
        const created = await createApplication(() => persist("Draft"));
        if (!created.ok) {
          setSubmitting(false);
          { toast({ title: "Application not created", description: created.reason, tone: "danger" }); return; }
        }
        const submitted = await submitApplication(created.appId!);
        toast(
          submitted.ok
            ? { title: "Application submitted", description: `${created.appId} sent to the BDM, Legal (collateral search) and Credit Analysis.`, tone: "success" }
            : { title: "Saved as draft — submission blocked", description: submitted.reason, tone: "warning" },
        );
        router.push(`/origination/application/?id=${created.appId}`);
      }}
    />
  );
}

