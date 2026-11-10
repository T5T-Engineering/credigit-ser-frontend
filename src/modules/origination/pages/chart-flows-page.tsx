"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import {
  Alert,
  ApprovalTimeline,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Chip,
  ChipList,
  Field,
  Grid,
  Input,
  KeyValueGrid,
  SegmentedControl,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
  Timeline,
} from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useUsers } from "@/lib/data/hooks";
import type { Application } from "@/lib/data/types";
import { roleById, roles, type RoleId } from "@/lib/rbac/roles";
import { FAST_TRACK_PAIR, getChartFlow, getFastTrackTier, signOnLimit, type Tier } from "@/lib/workflow";
import { money, moneyShort } from "@/lib/format";
import { buildChainFor, finalAuthority } from "../logic";
import { fastTrackVariants, PARAMS_HREF, slaDays, TENANT_PARAM_NOTE } from "../params";
import { toApprovalTiers } from "../view-models";
import { useRulesVersion, useStepUpThreshold } from "../use-params";

type Row = { tier: string; roles: RoleId[]; adjudicator?: RoleId; limit: number; slaHours: number };

const limitText = (n: number) => (n === Number.POSITIVE_INFINITY ? "Apex — no limit" : `Up to ${moneyShort(n)}`);

const toRow = (label: string) => (t: Tier): Row => ({ tier: label, roles: t.roles, adjudicator: t.adjudicator, limit: t.limit, slaHours: t.slaHours });
/** Matrices from the chart-flow business rules (read at call time). */
function standardRows(): Row[] {
  return getChartFlow().map((t, i) => toRow(`Tier ${i + 1}`)(t));
}
function fastTrackRows(): Row[] {
  return [toRow(FAST_TRACK_PAIR)(getFastTrackTier()), ...getChartFlow().slice(1).map((t, i) => toRow(`FT ${i + 2}`)(t))];
}

/** PRD §6.1.1 — Standard Credit chart-flow steps (default configuration). */
const standardSteps: { role: string; action: string }[] = [
  { role: "Customer", action: "Submits the credit application form and request letter with supporting documents." },
  { role: "Account Officer", action: "Reviews and initiates the request; it flows in parallel to the BDM and to Legal for collateral search." },
  { role: "BDM", action: "Concurs, declines or returns for rework; cannot submit until collateral due diligence is complete." },
  { role: "Group Head", action: "Approves, rejects or recommends; approved requests flow to the Credit Analyst." },
  { role: "Credit Analyst", action: "Scores and rates, runs 360 RAR, validates financials; co-signs with the Group Head." },
  { role: "Chief Credit Officer", action: "Reviews requests above the GH limit; adjudicates GH / CA dissent." },
  { role: "Directorate Head", action: "Approves within the limit co-signed with the CCO; others go to the CRO." },
  { role: "Chief Risk Officer", action: "Reviews above the HD limit; adjudicates CCO / HD dissent." },
  { role: "Managing Director", action: "Approves within the limit co-signed by the CRO." },
  { role: "Management Credit Committee", action: "Approves, declines or returns; adjudicates CRO / MD dissent." },
  { role: "Board Credit Committee", action: "Approves, declines or returns for rework." },
  { role: "Full Board", action: "Final approval at the apex tier." },
  { role: "Account Officer", action: "Presents the auto-generated offer letter and collects acceptance documents." },
  { role: "Legal", action: "Confirms security documents (incl. CSCS lien), vaults them and submits." },
  { role: "Credit Administration", action: "Confirms all approved terms and conditions before release." },
  { role: "Disbursement Maker / Checker", action: "Maker disburses; a different Checker authorises." },
];

function MatrixTable({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">{label}</caption>
        <TableHead>
          <TableRow>
            <TableHeaderCell>Tier</TableHeaderCell>
            <TableHeaderCell>Co-signer 1</TableHeaderCell>
            <TableHeaderCell>Co-signer 2</TableHeaderCell>
            <TableHeaderCell>Adjudicator (on dissent)</TableHeaderCell>
            <TableHeaderCell numeric>Limit</TableHeaderCell>
            <TableHeaderCell numeric>SLA</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.tier}>
              <TableCell>
                <span className="font-mono">{r.tier}</span>
              </TableCell>
              <TableCell>{roleById[r.roles[0]!].name}</TableCell>
              <TableCell>{r.roles[1] ? r.roles.slice(1).map((x) => roleById[x].name).join(", ") : <Text as="span" variant="small" tone="muted">{r.roles[0] === "bdm" ? "— recommends alone" : "— sole approver"}</Text>}</TableCell>
              <TableCell>{r.adjudicator ? roleById[r.adjudicator].name : <Text as="span" variant="small" tone="muted">—</Text>}</TableCell>
              <TableCell numeric>{limitText(r.limit)}</TableCell>
              <TableCell numeric>{r.slaHours}h</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ChartFlowsPage() {
  const users = useUsers();
  const threshold = useStepUpThreshold();
  useRulesVersion();
  const [flow, setFlow] = useState<Application["flow"]>("Standard");
  const [amount, setAmount] = useState("750000000");
  const amountN = Number(amount.replace(/[^\d]/g, "")) || 0;
  const chain = buildChainFor(flow, amountN, users);
  const approvers = roles.filter((r) => r.tier !== null).sort((a, b) => a.tier! - b.tier!);

  return (
    <ModulePage
      module="origination"
      description="The tenant's configured credit approval chart-flows: tiers, co-signer pairs, adjudicators, limits and SLA targets."
      actions={
        <Button as={Link} href={PARAMS_HREF} variant="tertiary" iconBefore={<Settings2 aria-hidden />}>
          Business rules
        </Button>
      }
    >
      <Stack gap="large">
        <Alert tone="info" title="Read-only view of tenant configuration">
          Tiers, signers, limit roles, adjudicators and SLAs are business rules (Operations → Business rules → Credit chart-flow); limits are the roles&apos; sign-on limits. Changes are approved in Operations and re-derive the matrices, the route simulator and the credit-approval workflows (Operations → Workflows, “Credit facility approval”) automatically.
        </Alert>

        <KeyValueGrid
          columns={4}
          items={[
            { label: "Approval tiers", value: String(getChartFlow().length), hint: "Standard credit ladder" },
            { label: "SLA — Standard", value: `${slaDays("Standard")} days`, hint: TENANT_PARAM_NOTE },
            { label: "SLA — Fast-Track", value: `${slaDays("Fast-Track")} days`, hint: TENANT_PARAM_NOTE },
            { label: "Step-up authentication", value: `Above ${moneyShort(threshold)}`, hint: "Every approval step re-authenticates (PRD §4.2)" },
          ]}
        />

        <Grid columns={1} gap="large">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Standard Credit — co-signer / adjudicator matrix</CardTitle>
                <CardDescription>PRD §6.1.2. BDM recommends, then co-signer pairs until the amount is within the pair&apos;s limit.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <MatrixTable rows={standardRows()} label="Standard credit matrix" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Fast-Track Credit — co-signer / adjudicator matrix</CardTitle>
                <CardDescription>PRD §6.1.3. Within the BDM&apos;s limit the BDM and the Fast-Track Analyst co-sign; GH, CCO and CRO are added beyond each limit.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Stack gap="medium">
                <MatrixTable rows={fastTrackRows()} label="Fast-Track credit matrix" />
                <Stack gap="small">
                  <Text variant="eyebrow">Eligible products</Text>
                  <ChipList>
                    {fastTrackVariants().map((v) => (
                      <Chip key={v.id} tone="accent">
                        {v.label}
                      </Chip>
                    ))}
                  </ChipList>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Route simulator</CardTitle>
              <CardDescription>See which tiers a request would need to pass for a given amount and flow.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Stack gap="large">
              <Grid columns={{ base: 1, md: 3 }} gap="medium">
                <Field label="Amount" htmlFor="sim-amount" description={amountN ? money(amountN) : undefined}>
                  <Input id="sim-amount" prefix="₦" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="Chart-flow" htmlFor="sim-flow">
                  <SegmentedControl
                    id="sim-flow"
                    label="Chart-flow"
                    value={flow}
                    onChange={setFlow}
                    options={[
                      { value: "Standard", label: "Standard" },
                      { value: "Fast-Track", label: "Fast-Track" },
                    ]}
                  />
                </Field>
                <KeyValueGrid columns={2} items={[{ label: "Final authority", value: finalAuthority(chain) }, { label: "Steps", value: String(chain.length), mono: true, hint: amountN > threshold ? "Step-up required" : "No step-up" }]} />
              </Grid>
              <ApprovalTimeline tiers={toApprovalTiers(chain, users)} />
            </Stack>
          </CardContent>
        </Card>

        <Grid columns={{ base: 1, lg: 2 }} gap="large">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Standard Credit chart-flow — end to end</CardTitle>
                <CardDescription>PRD §6.1.1 default configuration (16 steps). Tenants with fewer tiers run a shorter flow.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Timeline items={standardSteps.map((s, i) => ({ title: `${i + 1}. ${s.role}`, description: s.action, status: "upcoming" as const }))} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Approval roles and lending limits</CardTitle>
                <CardDescription>PRD §4.1 — sign-on limits from business rules ({TENANT_PARAM_NOTE.toLowerCase()}).</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table striped>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Role</TableHeaderCell>
                      <TableHeaderCell numeric>Tier</TableHeaderCell>
                      <TableHeaderCell numeric>Limit</TableHeaderCell>
                      <TableHeaderCell>Authority</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {approvers.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          {r.name} <Text as="span" variant="caption" tone="muted">({r.short})</Text>
                        </TableCell>
                        <TableCell numeric>{r.tier}</TableCell>
                        <TableCell numeric>{r.limitNgn === null ? "—" : signOnLimit(r.id) === Number.POSITIVE_INFINITY ? "Apex" : moneyShort(signOnLimit(r.id))}</TableCell>
                        <TableCell>
                          <Text variant="small">{r.authority}</Text>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </Grid>
      </Stack>
    </ModulePage>
  );
}
