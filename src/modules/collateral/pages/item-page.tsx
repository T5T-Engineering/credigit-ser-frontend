"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { FileSearch, Landmark, Send } from "lucide-react";
import {
  ActivityFeed,
  Alert,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  DescriptionList,
  DocumentList,
  EmptyState,
  EntityHeader,
  Field,
  FileUpload,
  Grid,
  Input,
  LineChart,
  Modal,
  Select,
  Stack,
  StatusBadge,
  Steps,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  Text,
  TextLink,
  Textarea,
  type DocumentItem,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useRole } from "@/lib/auth/session";
import { useAudit, useDocuments, useFacilities, useLookups } from "@/lib/data/hooks";
import { usePendingFor } from "@/lib/platform/operations";
import { useRule } from "@/lib/platform/rules";
import { DEMO_NOW } from "@/lib/data/seed";
import type { DocumentRecord, PerfectionStatus } from "@/lib/data/types";
import { date, dateTime, money, moneyShort, number, pct } from "@/lib/format";
import { PendingApproval } from "@/modules/monitoring/pending-approval";
import { cbnClassTones } from "@/modules/monitoring/logic";
import { insuranceOf, lienTones, moTones, valuationHistory, type ValuationEntry } from "../data";
import { collateralAbilities, facilityExposure, perfectionIndex, perfectionSteps, perfectionTones, priceSeries } from "../logic";
import {
  advancePerfection,
  confirmGenuineness,
  cureDefect,
  recordInsuranceRenewal,
  recordSearch,
  recordValuation,
  reportDefect,
  requestLegalSignoff,
  requestVerification,
  uploadDocuments,
  vaultDocuments,
  type Result,
} from "../service";
import { useCollateralStore, useCollateralView, useSharePrices } from "../store";

const docStatus: Record<DocumentRecord["status"], DocumentItem["status"]> = {
  Uploaded: "uploaded",
  "Processing OCR": "processing",
  Extracted: "extracted",
  Verified: "verified",
  Rejected: "rejected",
};

export function CollateralItemPage() {
  const params = useSearchParams();
  const id = params.get("id");
  const view = useCollateralView();
  const c = view.find((x) => x.id === id);
  const { obligor, user } = useLookups();
  const facilities = useFacilities();
  const documents = useDocuments();
  const auditLog = useAudit();
  const role = useRole();
  const can = collateralAbilities(role?.id);
  const store = useCollateralStore();
  const { asOf } = useSharePrices();
  const [modal, setModal] = useState<null | ModalKind>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const pending = usePendingFor("Collateral", id ?? "");
  const docAccept = useRule<string>("collateral.documents.accept");
  const docMaxMb = useRule<number>("collateral.documents.maxSizeMb");

  const history: ValuationEntry[] = useMemo(() => (c ? [...valuationHistory(c), ...(store.valuations[c.id] ?? [])] : []), [c, store.valuations]);

  if (!c) {
    return (
      <ModulePage module="collateral" hideTabs title="Collateral record">
        <EmptyState
          title="Collateral not found"
          description={id ? `No collateral with id ${id} exists in this tenant.` : "Open a collateral record from the register."}
          action={
            <Button as={Link} href="/collateral">
              Back to register
            </Button>
          }
        />
      </ModulePage>
    );
  }

  const o = obligor.get(c.obligorId);
  const linked = c.facilityIds.map((fid) => facilities.find((f) => f.id === fid)).filter((f) => !!f);
  const step = perfectionIndex(c.perfection);
  const insurance = insuranceOf(c);
  const legal = c.legalRecord;
  const shares = c.type === "Quoted shares";
  const series = shares && c.ticker ? priceSeries(c.ticker) : [];
  const docs: DocumentItem[] = [
    ...documents
      .filter((d) => d.ownerType === "collateral" && d.ownerId === c.id)
      .map((d) => ({ id: d.id, name: d.name, size: d.sizeKb * 1024, version: `v${d.version}`, uploadedBy: user.get(d.uploadedById)?.name, uploadedAt: date(d.uploadedAt), status: docStatus[d.status], category: d.kind })),
    {
      id: `${c.id}-title`,
      name: shares ? `CSCS share statement — ${c.ticker}.pdf` : c.type.includes("mortgage") ? "Certificate of Occupancy & deed of legal mortgage.pdf" : `Security instrument — ${c.type}.pdf`,
      size: 1_840_000,
      version: "v1",
      uploadedBy: "Legal Officer",
      uploadedAt: date(c.valuedAt),
      status: legal.genuineness === "Confirmed" ? "verified" : "uploaded",
      category: "Title document",
      note: legal.vaultRef ? `Vaulted · ${legal.vaultRef}` : undefined,
    },
    {
      id: `${c.id}-val`,
      name: shares ? `CSCS valuation evidence ${format(new Date(asOf), "yyyy-MM-dd")}.pdf` : `Valuation report — ${c.valuer}.pdf`,
      size: 2_960_000,
      version: `v${history.length}`,
      uploadedBy: shares ? "SEC/CSCS connector" : "Collateral Management Officer",
      uploadedAt: date(c.valuedAt),
      status: "extracted",
      category: "Valuation report",
    },
    ...(legal.searchStatus === "Clean" || legal.searchStatus === "Encumbrance found"
      ? [{ id: `${c.id}-search`, name: `Search report — ${legal.registry}.pdf`, size: 640_000, version: "v1", uploadedBy: "Legal Officer", uploadedAt: legal.searchAt ? date(legal.searchAt) : undefined, status: "verified" as const, category: "Legal search" }]
      : []),
  ];
  const activity = auditLog.filter((a) => a.entityId === c.id);

  const pendingType = pending?.operationType;
  const report = (r: Result<{ operationId?: string }>, okText: string) =>
    setMessage(r.ok ? { tone: "success", text: r.operationId ? `${okText} — submitted for approval (${r.operationId}).` : `${okText}.` } : { tone: "danger", text: r.reason });
  const setPerfection = async (to: PerfectionStatus, action: string) => report(await advancePerfection(c, to, action), action);

  const nextStep = step >= 0 && step < perfectionSteps.length - 1 ? perfectionSteps[step + 1]! : step === -1 ? perfectionSteps[0]! : undefined;
  const canAdvance =
    nextStep &&
    c.perfection !== "Defective" &&
    ((nextStep.owner === "legal-officer" && can.legal) || (nextStep.owner === "collateral-officer" && can.manage)) &&
    (nextStep.id !== "Documentation" || legal.searchStatus === "Clean") &&
    (nextStep.id !== "Registration" || legal.genuineness === "Confirmed");

  const headerActions = (
    <Stack direction="horizontal" gap="small" wrap>
      {can.manage && (
        <Button variant="secondary" onClick={() => setModal("revalue")}>
          {shares ? "Upload CSCS valuation" : "Record revaluation"}
        </Button>
      )}
      {can.legal && !legal.signOff && pendingType !== "collateral.legal.signoff" && (c.perfection === "Perfected" || c.perfection === "Registration") && <Button onClick={() => setModal("signoff")}>Legal sign-off</Button>}
    </Stack>
  );

  return (
    <ModulePage module="collateral" hideTabs title="Collateral record">
      <Stack gap="large">
        <EntityHeader
          titleAs="h2"
          back={{ href: "/collateral", label: "Collateral register" }}
          linkComponent={Link}
          eyebrow={c.type}
          title={shares ? `${c.ticker} — ${number(c.units ?? 0)} units` : c.description}
          subtitle={
            <>
              {o?.name ?? c.obligorId} · {c.location ?? "—"}
            </>
          }
          identifier={c.id}
          identifierLabel="Collateral ID"
          status={{ status: c.perfection, tones: perfectionTones }}
          actions={headerActions}
          facts={[
            { label: shares ? "Mark-to-market" : "Market value", value: moneyShort(c.mtm ?? c.marketValue), mono: true },
            { label: shares ? "Price (CSCS)" : "Forced-sale value", value: shares ? `₦${c.price?.toFixed(2)}` : moneyShort(c.forcedSaleValue), mono: true },
            { label: "Haircut", value: `${c.haircutPct}%`, mono: true },
            { label: "Adjusted value", value: moneyShort(c.adjusted), mono: true },
            { label: "Cover", value: c.exposure > 0 ? pct(c.cover * 100, 0) : "—", mono: true },
            { label: "MO verification", value: c.verification.status },
          ]}
        />

        {message && (
          <Alert tone={message.tone} title={message.tone === "danger" ? "Not completed" : "Done"}>
            {message.text}
          </Alert>
        )}
        {pending && pendingType !== "collateral.valuation.verify" && <PendingApproval subjectType="Collateral" subjectId={c.id} />}

        {!c.eligible && (
          <Alert tone="warning" title="Haircut adjustment not yet eligible">
            Adjustment is only permitted where the collateral is perfected, realisable without restriction and regularly and transparently valued (CBN 12.13(a)(1)). Current step: {c.perfection}.
          </Alert>
        )}

        <Tabs
          label="Collateral record"
          defaultValue={params.get("tab") ?? "overview"}
          variant="underline"
          items={[
            {
              id: "overview",
              label: "Overview",
              content: (
                <Grid columns={{ base: 1, lg: 3 }} gap="large">
                  <div className="min-w-0 lg:col-span-2">
                    <Stack gap="large">
                      <Card>
                        <CardHeader>
                          <CardTitle>Details</CardTitle>
                        </CardHeader>
                        <DescriptionList
                          columns={2}
                          items={[
                            { label: "Obligor", value: o ? <TextLink as={Link} href={`/credit-analysis/assessment?id=${o.id}`}>{o.name}</TextLink> : c.obligorId },
                            { label: "Type", value: c.type },
                            { label: "Description", value: c.description, span: 2 },
                            { label: "Valuer", value: shares ? "CSCS market data" : c.valuer, hint: shares ? `Source logged with timestamp ${dateTime(asOf)}` : undefined },
                            { label: "Valued", value: shares ? dateTime(asOf) : date(c.valuedAt) },
                            { label: "Value basis", value: c.basis },
                            { label: "Haircut weighting", value: `${c.haircutPct}%`, hint: c.haircutSource },
                            { label: "Next revaluation", value: shares ? "Daily close (SEC/CSCS connector)" : date(c.nextRevaluation) },
                            { label: "Currency", value: "NGN — no currency-mismatch overlay" },
                            ...(shares ? [{ label: "Lien status", status: c.lien, statusTones: lienTones }, { label: "Units pledged", value: number(c.units ?? 0), mono: true }] : []),
                          ]}
                        />
                      </Card>
                      <Card>
                        <CardHeader>
                          <div>
                            <CardTitle>Coverage vs linked facilities</CardTitle>
                            <CardDescription>Exposure from the CBA facility book; contingent amount for guarantees.</CardDescription>
                          </div>
                        </CardHeader>
                        {linked.length ? (
                          <Table>
                            <TableHead>
                              <TableRow>
                                <TableHeaderCell>Facility</TableHeaderCell>
                                <TableHeaderCell>Product</TableHeaderCell>
                                <TableHeaderCell>CBN class</TableHeaderCell>
                                <TableHeaderCell numeric>Exposure</TableHeaderCell>
                                <TableHeaderCell numeric>DPD</TableHeaderCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {linked.map((f) => (
                                <TableRow key={f.id}>
                                  <TableCell className="font-mono">{f.id}</TableCell>
                                  <TableCell>{f.product}</TableCell>
                                  <TableCell>
                                    <StatusBadge status={f.cbnClass} tones={cbnClassTones} />
                                  </TableCell>
                                  <TableCell numeric>{money(facilityExposure(f), f.currency)}</TableCell>
                                  <TableCell numeric>{f.dpd}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <Text tone="subtle">Not linked to a live facility.</Text>
                        )}
                      </Card>
                    </Stack>
                  </div>
                  <Stack gap="large">
                    <Card variant="filled">
                      <CardHeader>
                        <div>
                          <CardTitle>Haircut-adjusted value</CardTitle>
                          <CardDescription>PRD §6.7.3 — Required provision = Total exposure − {"{"}Value of collateral × (1 − Haircut weighting){"}"}</CardDescription>
                        </div>
                      </CardHeader>
                      <DescriptionList
                        columns={1}
                        layout="inline"
                        items={[
                          { label: "Value of collateral", value: money(c.basisValue), mono: true, hint: c.basis },
                          { label: "× (1 − haircut)", value: `× ${(1 - c.haircutPct / 100).toFixed(2)}`, mono: true },
                          { label: "Adjusted value", value: money(c.adjusted), mono: true },
                          { label: "Total exposure", value: money(c.exposure), mono: true },
                          { label: "Required provision (if Lost)", value: money(Math.max(0, c.exposure - (c.eligible ? c.adjusted : 0))), mono: true },
                        ]}
                      />
                    </Card>
                    <Card>
                      <CardHeader>
                        <div>
                          <CardTitle>Middle Office verification</CardTitle>
                          <CardDescription>Independent price / valuation verification between front office and risk control.</CardDescription>
                        </div>
                      </CardHeader>
                      <Stack gap="medium">
                        <StatusBadge status={c.verification.status} tones={moTones} />
                        {c.verification.by && (
                          <Text variant="small" tone="muted">
                            {c.verification.by}
                            {c.verification.at ? ` · ${dateTime(c.verification.at)}` : ""}
                          </Text>
                        )}
                        {c.verification.note && <Text variant="small">{c.verification.note}</Text>}
                        {pendingType === "collateral.valuation.verify" && <PendingApproval subjectType="Collateral" subjectId={c.id} label="Awaiting Middle Office verification" />}
                        {can.manage && !pending && c.verification.status !== "Verified" && (
                          <Button size="small" variant="secondary" iconBefore={<Send aria-hidden className="size-4" />} onClick={async () => report(await requestVerification(c), "Valuation sent for verification")}>
                            Send for verification
                          </Button>
                        )}
                        {can.verify && !pending && c.verification.status !== "Verified" && (
                          <Text variant="caption" tone="subtle">
                            Verification requests arrive in Operations → Approvals: approve to verify, reject to query.
                          </Text>
                        )}
                        {can.manage && (
                          <Text variant="caption" tone="subtle">
                            Segregation of duties: the officer who records a valuation can’t verify it.
                          </Text>
                        )}
                      </Stack>
                    </Card>
                  </Stack>
                </Grid>
              ),
            },
            {
              id: "valuation",
              label: "Valuation",
              badge: String(history.length),
              content: (
                <Stack gap="large">
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle>{shares ? "Simulated NGX closing price (30 trading days)" : "Valuation history"}</CardTitle>
                        <CardDescription>{shares ? "Simulated demo prices — not market data. Phase 2: automated SEC/CSCS feed." : "Open market value and forced-sale value per valuation."}</CardDescription>
                      </div>
                    </CardHeader>
                    {shares ? (
                      <LineChart label={`${c.ticker} price`} height={220} yFormatter={(v) => `₦${v.toFixed(0)}`} series={[{ name: c.ticker ?? "Price", tone: "accent", points: series.map((p) => ({ x: format(p.date, "d MMM"), y: p.price })) }]} />
                    ) : (
                      <LineChart
                        label="Valuation history"
                        height={220}
                        yFormatter={(v) => moneyShort(v)}
                        series={[
                          { name: "Market value", tone: "accent", points: history.map((h) => ({ x: format(new Date(h.at), "MMM yy"), y: h.marketValue })) },
                          { name: "Forced-sale value", tone: "info", points: history.map((h) => ({ x: format(new Date(h.at), "MMM yy"), y: h.forcedSaleValue })) },
                        ]}
                      />
                    )}
                  </Card>
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Date</TableHeaderCell>
                        <TableHeaderCell>Valuer / source</TableHeaderCell>
                        <TableHeaderCell>Basis & assumptions</TableHeaderCell>
                        <TableHeaderCell numeric>Market value</TableHeaderCell>
                        <TableHeaderCell numeric>FSV</TableHeaderCell>
                        <TableHeaderCell>Reference</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {[...history].reverse().map((h) => (
                        <TableRow key={h.id}>
                          <TableCell>{date(h.at)}</TableCell>
                          <TableCell>
                            <Stack gap="none">
                              <span className="text-fg">{h.valuer}</span>
                              <Text variant="caption" tone="subtle">
                                {h.source}
                              </Text>
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Stack gap="none">
                              <span>{h.basis}</span>
                              <Text variant="caption" tone="subtle">
                                {h.assumptions}. FSV: {h.fsvMethod}
                              </Text>
                            </Stack>
                          </TableCell>
                          <TableCell numeric>{moneyShort(h.marketValue)}</TableCell>
                          <TableCell numeric>{moneyShort(h.forcedSaleValue)}</TableCell>
                          <TableCell className="font-mono">{h.reference}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Stack>
              ),
            },
            {
              id: "perfection",
              label: "Perfection & legal",
              content: (
                <Stack gap="large">
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle>Perfection workflow</CardTitle>
                        <CardDescription>Search and documentation by Legal; registration and perfection by Collateral Management.</CardDescription>
                      </div>
                      {canAdvance && nextStep && !(nextStep.id === "Perfected" && pendingType === "collateral.perfection.complete") && (
                        <Button onClick={() => setPerfection(nextStep.id, `Advanced perfection to ${nextStep.title}`)}>
                          {nextStep.id === "Perfected" ? "Request perfection sign-off" : `Advance to ${nextStep.title.toLowerCase()}`}
                        </Button>
                      )}
                    </CardHeader>
                    <Steps
                      orientation="horizontal"
                      items={perfectionSteps.map((p, i) => ({
                        title: p.title,
                        description: p.description,
                        status: c.perfection === "Perfected" || i < step ? ("complete" as const) : i === step ? ("current" as const) : ("upcoming" as const),
                        meta: p.owner === "legal-officer" ? "Legal Officer" : "Collateral Mgmt",
                      }))}
                    />
                    {c.perfection === "Defective" && (
                      <Alert tone="danger" title="Defect reported" className="mt-4">
                        Legal found a defect in the security documents. Cure the defect and restart documentation.
                        {can.legal && (
                          <Button size="small" variant="secondary" className="ml-3" onClick={() => (cureDefect(c), setMessage({ tone: "success", text: "Defect cured — returned to documentation." }))}>
                            Mark defect cured
                          </Button>
                        )}
                      </Alert>
                    )}
                  </Card>
                  <Grid columns={{ base: 1, lg: 2 }} gap="large">
                    <Card>
                      <CardHeader>
                        <CardTitle>Legal review</CardTitle>
                      </CardHeader>
                      <DescriptionList
                        columns={1}
                        layout="inline"
                        items={[
                          { label: "Registry", value: legal.registry },
                          { label: "Legal search", status: legal.searchStatus, statusTones: { Clean: "success", "Encumbrance found": "danger", Requested: "info", "Not requested": "neutral" }, hint: legal.searchAt ? date(legal.searchAt) : undefined },
                          { label: "Genuineness / authenticity", status: legal.genuineness, statusTones: { Confirmed: "success", Pending: "info", Doubtful: "danger" } },
                          { label: "Vault reference", value: legal.vaultRef, mono: true, hint: legal.vaultedAt ? `Vaulted ${date(legal.vaultedAt)}` : undefined },
                          { label: "Legal sufficiency sign-off", value: legal.signOff ? `${legal.signOff.by} · ${dateTime(legal.signOff.at)}` : undefined, hint: legal.signOff?.opinion },
                        ]}
                      />
                      {can.legal && (
                        <Stack direction="horizontal" gap="small" wrap className="mt-4">
                          {(legal.searchStatus === "Not requested" || legal.searchStatus === "Requested") && (
                            <Button size="small" variant="secondary" iconBefore={<FileSearch aria-hidden className="size-4" />} onClick={() => setModal("search")}>
                              Record search result
                            </Button>
                          )}
                          {legal.genuineness !== "Confirmed" && legal.searchStatus === "Clean" && (
                            <Button
                              size="small"
                              variant="secondary"
                              onClick={() => confirmGenuineness(c, legal.genuineness)}
                            >
                              Confirm genuineness
                            </Button>
                          )}
                          {!legal.vaultRef && legal.genuineness === "Confirmed" && (
                            <Button size="small" variant="secondary" iconBefore={<Landmark aria-hidden className="size-4" />} onClick={() => setModal("vault")}>
                              Vault documents
                            </Button>
                          )}
                          {c.perfection !== "Defective" && c.perfection !== "Perfected" && (
                            <Button size="small" variant="text" onClick={() => setModal("defect")}>
                              Report defect
                            </Button>
                          )}
                        </Stack>
                      )}
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Insurance</CardTitle>
                      </CardHeader>
                      {insurance ? (
                        <>
                          <DescriptionList
                            columns={1}
                            layout="inline"
                            items={[
                              { label: "Insurer", value: insurance.insurer },
                              { label: "Policy", value: insurance.policyNo, mono: true },
                              { label: "Sum insured", value: money(insurance.sumInsured), mono: true },
                              {
                                label: "Expiry",
                                value: date(c.insuranceExpiryEffective ?? insurance.expiry),
                                hint: new Date(c.insuranceExpiryEffective ?? insurance.expiry) < DEMO_NOW ? "Expired — cover not current" : undefined,
                              },
                              { label: "Bank’s interest noted", value: insurance.bankInterestNoted ? "Yes" : "No — request endorsement" },
                            ]}
                          />
                          {can.manage && (
                            <Button size="small" variant="secondary" className="mt-4" onClick={() => setModal("insurance")}>
                              Record renewal
                            </Button>
                          )}
                        </>
                      ) : (
                        <Text tone="subtle">Insurance is not required for this collateral type.</Text>
                      )}
                    </Card>
                  </Grid>
                </Stack>
              ),
            },
            {
              id: "documents",
              label: "Documents",
              badge: String(docs.length),
              content: (
                <Stack gap="large">
                  <DocumentList documents={docs} />
                  {(can.manage || can.legal) && (
                    <Card variant="filled">
                      <Stack gap="medium">
                        <FileUpload
                          accept={docAccept}
                          multiple
                          maxSizeMb={docMaxMb}
                          files={files}
                          onFilesChange={setFiles}
                        />
                        <Stack direction="horizontal" gap="small">
                          <Button
                            disabled={!files.length}
                            onClick={() => {
                              uploadDocuments(c, files);
                              setFiles([]);
                            }}
                          >
                            Upload {files.length ? `(${files.length})` : ""}
                          </Button>
                          <Text variant="caption" tone="subtle" className="self-center">
                            Every re-upload is kept as a new version (PRD §5.4).
                          </Text>
                        </Stack>
                      </Stack>
                    </Card>
                  )}
                </Stack>
              ),
            },
            {
              id: "activity",
              label: "Activity",
              content: (
                <ActivityFeed
                  label="Collateral activity"
                  detailed
                  emptyMessage="No changes recorded for this collateral yet."
                  items={activity.map((a) => ({
                    id: a.id,
                    actor: { name: a.actorName, role: a.roleId },
                    action: a.action,
                    timestamp: a.at,
                    changes: a.before || a.after ? [{ field: "Value", before: a.before, after: a.after }] : undefined,
                    ip: a.ip,
                    device: a.device,
                  }))}
                />
              ),
            },
          ]}
        />
      </Stack>

      {modal && (
        <ActionModal
          kind={modal}
          collateralName={`${c.id} · ${o?.name ?? ""}`}
          shares={shares}
          onClose={() => setModal(null)}
          onSubmit={async (v) => {
            setModal(null);
            switch (modal) {
              case "revalue":
                report(await recordValuation(c, { marketValue: Number(v.mv), forcedSaleValue: Number(v.fsv), valuer: v.valuer ?? "", basis: v.basis, assumptions: v.note, reference: v.reference }), "Valuation recorded");
                break;
              case "insurance":
                recordInsuranceRenewal(c, c.insuranceExpiryEffective, v.date!);
                setMessage({ tone: "success", text: "Insurance renewal recorded." });
                break;
              case "search":
                recordSearch(c, legal.searchStatus, v.result as "Clean" | "Encumbrance found");
                break;
              case "vault":
                setMessage({ tone: "success", text: `Documents vaulted — ${vaultDocuments(c, v.reference)}.` });
                break;
              case "signoff":
                report(await requestLegalSignoff(c, v.note ?? ""), "Legal sufficiency opinion");
                break;
              case "defect":
                report(reportDefect(c, v.note ?? ""), "Defect reported");
                break;
            }
          }}
        />
      )}
    </ModulePage>
  );
}

type ModalKind = "revalue" | "insurance" | "search" | "signoff" | "vault" | "defect";
type Values = Record<string, string>;

const modalMeta: Record<ModalKind, { title: string; cta: string }> = {
  revalue: { title: "Record revaluation", cta: "Save valuation" },
  insurance: { title: "Record insurance renewal", cta: "Save renewal" },
  search: { title: "Record legal search result", cta: "Save result" },
  signoff: { title: "Legal sufficiency sign-off", cta: "Submit for acceptance" },
  vault: { title: "Vault security documents", cta: "Confirm vaulting" },
  defect: { title: "Report perfection defect", cta: "Report defect" },
};

function ActionModal({ kind, collateralName, shares, onClose, onSubmit }: { kind: ModalKind; collateralName: string; shares: boolean; onClose: () => void; onSubmit: (v: Values) => void }) {
  const [v, setV] = useState<Values>({ result: "Clean", note: kind === "signoff" ? "Security documents genuine; perfection complete; legally sufficient." : "" });
  const bases = useRule<string[]>("collateral.valuation.bases");
  const minText = useRule<number>("collateral.legal.minOpinionLength");
  const set = (k: string) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const valid =
    kind === "revalue"
      ? Number(v.mv) > 0 && (shares || (Number(v.fsv) > 0 && !!v.valuer?.trim()))
      : kind === "insurance"
        ? !!v.date
        : kind === "defect" || kind === "signoff"
          ? (v.note?.trim().length ?? 0) >= minText
          : true;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={modalMeta[kind].title}
      description={collateralName}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(v)} disabled={!valid}>
            {modalMeta[kind].cta}
          </Button>
        </>
      }
    >
      <Stack gap="medium">
        {kind === "revalue" && (
          <>
            {shares && <Alert tone="info">Phase 1: manual upload of CSCS share-statement / valuation evidence (PRD §5.7). Phase 2 refreshes automatically.</Alert>}
            <Field label={shares ? "Mark-to-market value" : "Open market value"} htmlFor="m-mv" required>
              <Input id="m-mv" type="number" prefix="₦" value={v.mv ?? ""} onChange={set("mv")} />
            </Field>
            {!shares && (
              <>
                <Field label="Forced-sale value" htmlFor="m-fsv" required>
                  <Input id="m-fsv" type="number" prefix="₦" value={v.fsv ?? ""} onChange={set("fsv")} />
                </Field>
                <Field label="Independent valuer" htmlFor="m-valuer" required>
                  <Input id="m-valuer" value={v.valuer ?? ""} onChange={set("valuer")} />
                </Field>
                <Field label="Valuation basis" htmlFor="m-basis">
                  <Select
                    id="m-basis"
                    value={v.basis ?? bases[0] ?? ""}
                    onChange={set("basis")}
                    options={bases.map((x) => ({ value: x, label: x }))}
                  />
                </Field>
              </>
            )}
            <Field label="Assumptions / FSV methodology" htmlFor="m-note" optional>
              <Textarea id="m-note" rows={2} value={v.note} onChange={set("note")} />
            </Field>
            <Field label="Report reference" htmlFor="m-ref" optional>
              <Input id="m-ref" value={v.reference ?? ""} onChange={set("reference")} />
            </Field>
            <Text variant="caption" tone="subtle">
              The new valuation goes to Middle Office for independent verification.
            </Text>
          </>
        )}
        {(kind === "defect" || kind === "signoff") && (
          <Field label={kind === "signoff" ? "Legal opinion" : "Reason"} htmlFor="m-note2" required description={kind === "signoff" ? "Credit Administration accepts the opinion through the Operations workflow." : undefined}>
            <Textarea id="m-note2" rows={3} value={v.note} onChange={set("note")} />
          </Field>
        )}
        {kind === "insurance" && (
          <Field label="New expiry date" htmlFor="m-date" required>
            <Input id="m-date" type="date" value={v.date ?? ""} onChange={set("date")} min={format(DEMO_NOW, "yyyy-MM-dd")} />
          </Field>
        )}
        {kind === "search" && (
          <Field label="Search result" htmlFor="m-result">
            <Select id="m-result" value={v.result} onChange={set("result")} options={[{ value: "Clean", label: "Clean — no encumbrance" }, { value: "Encumbrance found", label: "Encumbrance found" }]} />
          </Field>
        )}
        {kind === "vault" && (
          <Field label="Vault reference" htmlFor="m-vault" optional description="Leave blank to generate one.">
            <Input id="m-vault" value={v.reference ?? ""} onChange={set("reference")} />
          </Field>
        )}
      </Stack>
    </Modal>
  );
}

