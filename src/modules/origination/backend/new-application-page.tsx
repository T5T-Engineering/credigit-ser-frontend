"use client";

/**
 * New credit request (and draft edit, `?id=`) on the backend API. The backend checks `origination.applications.create` / `.update` /
 * `.submit`, the initiator role group and the product catalogue; documents are added on the record once the draft exists (the DMS
 * needs an application to attach them to).
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DescriptionList, Field, Grid, Input, PermissionGate, Select, Spinner, Stack, Text, Textarea } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { money } from "@/lib/format";
import { useCan } from "@/lib/iam/permissions";
import { useRule } from "@/lib/platform/rules";
import { useMasterDataValues } from "@/modules/master-data/api";
import { fastTrackVariants, num, productOptions } from "../params";
import { useRulesVersion } from "../use-params";
import { OBLIGOR_TYPES, REQUEST_TYPES, applicationHref, errorText, originationApi, useBackend, type ApprovalRoute, type CreditApplication, type Customer, type FacilityRequest, type ObligorType, type RequestType } from "./api";

type Form = {
  name: string;
  type: ObligorType;
  sectorId: string;
  branch: string;
  rcNumber: string;
  state: string;
  turnover: string;
  product: string;
  variant: string;
  amount: string;
  tenor: string;
  purpose: string;
  requestType: RequestType;
  existingFacilityRef: string;
};

const toNumber = (s: string) => (s.trim() === "" ? null : Number(s.replace(/,/g, "")));

export function BackendNewApplicationPage() {
  return (
    <Suspense fallback={<Spinner label="Loading" />}>
      <NewApplication />
    </Suspense>
  );
}

function NewApplication() {
  const id = useSearchParams().get("id");
  const canCreate = useCan("origination.applications.create");
  const canUpdate = useCan("origination.applications.update");
  const existing = useBackend(id ? () => originationApi.get(id) : null, [id]);
  const draft = existing.data?.application ?? null;

  if (!(id ? canUpdate : canCreate)) return <PermissionGate allowed={false} description="You don't have permission to create or edit credit requests.">{null}</PermissionGate>;
  if (id && existing.loading) return <Spinner label="Loading the draft" />;
  if (id && (existing.error || !draft || draft.stage !== "Draft")) {
    return <Alert tone="danger">{existing.error ?? `Application ${id} is no longer a draft and can't be edited.`}</Alert>;
  }
  return <Editor key={draft?.id ?? "new"} draft={draft} />;
}

const emptyForm = (): Form => ({
  name: "",
  type: "Corporate",
  sectorId: "",
  branch: "",
  rcNumber: "",
  state: "",
  turnover: "",
  product: "",
  variant: "",
  amount: "",
  tenor: String(num("defaultTenorMonths")),
  purpose: "",
  requestType: "New",
  existingFacilityRef: "",
});

const draftForm = ({ customer: c, facility: f }: CreditApplication): Form => ({
  name: c.name,
  type: c.type,
  sectorId: c.sectorId ?? "",
  branch: c.branch ?? "",
  rcNumber: c.rcNumber ?? "",
  state: c.state ?? "",
  turnover: c.declaredTurnoverNgn == null ? "" : String(c.declaredTurnoverNgn),
  product: f.product,
  variant: f.variant ?? "",
  amount: String(f.amountNgn),
  tenor: String(f.tenorMonths),
  purpose: f.purpose,
  requestType: f.requestType,
  existingFacilityRef: f.existingFacilityRef ?? "",
});

function Editor({ draft }: { draft: CreditApplication | null }) {
  const router = useRouter();
  const canSubmit = useCan("origination.applications.submit");
  const rulesVersion = useRulesVersion();
  const sectors = useMasterDataValues("sector").values;
  const branches = useMasterDataValues("branch").values;
  // Request types and which act on an existing facility are business rules (backend ORG-FR-21).
  const enabledTypes = useRule<string[]>("origination.requestTypes.enabled");
  const facilityTypes = useRule<string[]>("origination.requestTypes.requireExistingFacility");
  const requestTypes = REQUEST_TYPES.filter((t) => enabledTypes.includes(t));

  // eslint-disable-next-line react-hooks/exhaustive-deps -- rules are read at call time; re-derive when they change
  const products = useMemo(() => productOptions() as string[], [rulesVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
  const variants = useMemo(() => fastTrackVariants(), [rulesVersion]);

  const [form, setForm] = useState<Form>(() => (draft ? draftForm(draft) : emptyForm()));
  const needsFacility = facilityTypes.includes(form.requestType);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; route: ApprovalRoute | null }>({ key: "", route: null });

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const amount = toNumber(form.amount);
  const flow = form.variant ? "Fast-Track" : "Standard";
  const previewKey = amount && amount > 0 ? `${amount}|${flow}` : "";
  const route = preview.key === previewKey ? preview.route : null;

  useEffect(() => {
    if (!previewKey || !amount) return;
    let live = true;
    const t = window.setTimeout(() => {
      originationApi
        .routePreview(amount, flow)
        .then((r) => live && setPreview({ key: previewKey, route: r }))
        .catch(() => live && setPreview({ key: previewKey, route: null }));
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [previewKey, amount, flow]);

  const missing = [
    !form.name.trim() && "customer name",
    !form.product && "product",
    !(amount && amount > 0) && "amount",
    !(Number(form.tenor) > 0) && "tenor",
    !form.purpose.trim() && "purpose",
  ].filter(Boolean) as string[];

  const payload = (): { customer: Customer; facility: FacilityRequest } => ({
    customer: {
      obligorId: draft?.customer.obligorId ?? null,
      name: form.name.trim(),
      type: form.type,
      sectorId: form.sectorId || null,
      rcNumber: form.rcNumber.trim() || null,
      branch: form.branch || null,
      state: form.state.trim() || null,
      declaredTurnoverNgn: toNumber(form.turnover),
    },
    facility: { product: form.product, amountNgn: amount ?? 0, tenorMonths: Number(form.tenor), purpose: form.purpose.trim(), requestType: form.requestType, variant: form.variant || null, existingFacilityRef: form.existingFacilityRef.trim() || null },
  });

  const save = async (andSubmit: boolean) => {
    if (missing.length) return setError(`Fill in the ${missing.join(", ")}.`);
    setBusy(true);
    setError(null);
    try {
      const { customer, facility } = payload();
      const ack = draft ? await originationApi.update(draft.id, customer, facility, draft.version) : await originationApi.create(customer, facility);
      if (andSubmit) await originationApi.submit(ack.applicationId);
      router.push(applicationHref(ack.applicationId));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <ModulePage module="origination" title={draft ? `Edit draft ${draft.id}` : "New application"} description="Capture the customer and the facility requested. Add documents on the application once the draft is saved.">
      <Grid columns={{ base: 1, lg: 3 }} gap="large">
        <div className="lg:col-span-2">
          <Stack gap="large">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Customer</CardTitle>
                  <CardDescription>The obligor as captured on the request.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Grid columns={{ base: 1, md: 2 }} gap="medium">
                  <Field label="Customer name" htmlFor="c-name" required>
                    <Input id="c-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
                  </Field>
                  <Field label="Obligor type" htmlFor="c-type" required>
                    <Select id="c-type" value={form.type} onChange={(e) => set("type", e.target.value as ObligorType)} options={OBLIGOR_TYPES.map((t) => ({ value: t, label: t }))} />
                  </Field>
                  <Field label="Sector" htmlFor="c-sector" optional>
                    <Select id="c-sector" value={form.sectorId} onChange={(e) => set("sectorId", e.target.value)} options={[{ value: "", label: "Not set" }, ...sectors.map((s) => ({ value: s.code, label: s.label }))]} />
                  </Field>
                  <Field label="Branch" htmlFor="c-branch" optional>
                    <Select id="c-branch" value={form.branch} onChange={(e) => set("branch", e.target.value)} options={[{ value: "", label: "Not set" }, ...branches.map((b) => ({ value: b.code, label: b.label }))]} />
                  </Field>
                  <Field label="RC number" htmlFor="c-rc" optional>
                    <Input id="c-rc" value={form.rcNumber} onChange={(e) => set("rcNumber", e.target.value)} />
                  </Field>
                  <Field label="State" htmlFor="c-state" optional>
                    <Input id="c-state" value={form.state} onChange={(e) => set("state", e.target.value)} />
                  </Field>
                  <Field label="Declared annual turnover (NGN)" htmlFor="c-turnover" optional description="Used for the COP Ratio once statements are reconciled.">
                    <Input id="c-turnover" inputMode="decimal" value={form.turnover} onChange={(e) => set("turnover", e.target.value)} />
                  </Field>
                </Grid>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Facility</CardTitle>
                  <CardDescription>Choosing a Fast-Track variant routes the request on the Fast-Track flow when within its ceiling.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Grid columns={{ base: 1, md: 2 }} gap="medium">
                  <Field label="Fast-Track variant" htmlFor="f-variant" optional>
                    <Select
                      id="f-variant"
                      value={form.variant}
                      onChange={(e) => {
                        const v = variants.find((x) => x.label === e.target.value);
                        setForm((f) => ({ ...f, variant: e.target.value, product: v ? v.product : f.product }));
                      }}
                      options={[{ value: "", label: "None — Standard flow" }, ...variants.map((v) => ({ value: v.label, label: `${v.label} (${v.product})` }))]}
                    />
                  </Field>
                  <Field label="Product" htmlFor="f-product" required>
                    <Select id="f-product" value={form.product} disabled={Boolean(form.variant)} onChange={(e) => set("product", e.target.value)} options={[{ value: "", label: "Choose a product" }, ...products.map((p) => ({ value: p, label: p }))]} />
                  </Field>
                  <Field label="Amount (NGN)" htmlFor="f-amount" required>
                    <Input id="f-amount" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} />
                  </Field>
                  <Field label="Tenor (months)" htmlFor="f-tenor" required>
                    <Input id="f-tenor" type="number" min={1} value={form.tenor} onChange={(e) => set("tenor", e.target.value)} />
                  </Field>
                  <Field label="Request type" htmlFor="f-type" required>
                    <Select id="f-type" value={form.requestType} onChange={(e) => set("requestType", e.target.value as RequestType)} options={requestTypes.map((t) => ({ value: t, label: t }))} />
                  </Field>
                  {needsFacility ? (
                    <Field label="Existing facility reference" htmlFor="f-facility" required description="The facility in the exposure book this request renews, enhances or restructures.">
                      <Input id="f-facility" value={form.existingFacilityRef} onChange={(e) => set("existingFacilityRef", e.target.value)} />
                    </Field>
                  ) : null}
                  <div className="md:col-span-2">
                    <Field label="Purpose" htmlFor="f-purpose" required>
                      <Textarea id="f-purpose" rows={3} value={form.purpose} onChange={(e) => set("purpose", e.target.value)} />
                    </Field>
                  </div>
                </Grid>
              </CardContent>
            </Card>
          </Stack>
        </div>
        <Stack gap="large">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Approval route</CardTitle>
                <CardDescription>Planned from the tenant chart-flow rules for this amount; fixed when submitted for approval.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {route ? (
                <DescriptionList
                  items={[
                    { label: "Flow", value: route.flow },
                    { label: "Amount", value: amount ? money(amount) : "—" },
                    ...route.steps.map((s) => ({ label: s.name, value: `${s.approverRoles.join(" + ")}${s.adjudicatorRole ? ` · adjudicator ${s.adjudicatorRole}` : ""}` })),
                  ]}
                />
              ) : (
                <Text variant="small" tone="muted">Enter an amount to preview the route.</Text>
              )}
            </CardContent>
          </Card>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Stack gap="small">
            <Button variant="secondary" loading={busy} disabled={busy} onClick={() => void save(false)}>
              Save draft
            </Button>
            {canSubmit ? (
              <Button loading={busy} disabled={busy} onClick={() => void save(true)}>
                Save and submit
              </Button>
            ) : null}
            <Button as={Link} href={draft ? applicationHref(draft.id) : "/origination/"} variant="tertiary">
              Cancel
            </Button>
          </Stack>
        </Stack>
      </Grid>
    </ModulePage>
  );
}
