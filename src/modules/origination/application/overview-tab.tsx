"use client";

import Link from "next/link";
import { AiDraftPanel, Card, CardContent, CardHeader, CardTitle, ChecklistPanel, DescriptionList, Grid, Stack, Steps, TextLink } from "@credigit/web-ui";
import { DEMO_NOW } from "@/lib/data/seed";
import { date, dateTime, money } from "@/lib/format";
import { roleById } from "@/lib/rbac/roles";
import { fastTrackVariants, inGroup } from "../params";
import { recordChange } from "../actions";
import { recommendationLabel, recommendationLabelTones } from "../logic";
import type { AppCtx } from "./context";
import { gateItems } from "./next-step";
import { draftMemo } from "./memo";

const lifecycle = ["Draft", "Documents", "Analysis", "Recommendation", "Approval", "Offer", "Conditions", "Disbursement", "Booked"] as const;

export function OverviewTab({ c }: { c: AppCtx }) {
  const { app, obligor, sector } = c;
  const creator = c.users.find((u) => u.id === app.createdById);
  const rm = c.users.find((u) => u.id === obligor.relationshipManagerId);
  const index = lifecycle.indexOf(app.stage as (typeof lifecycle)[number]);
  const variant = fastTrackVariants().find((v) => v.id === c.extra.variant);
  const memo = c.extra.memo;
  const canSign = c.canEdit && inGroup("recommenders", c.roleId);

  return (
    <Stack gap="large">
      <Card className="hidden md:block">
        <CardContent className="overflow-x-auto">
          <Steps
            orientation="horizontal"
            items={lifecycle.map((s, i) => ({
              title: s,
              status: index < 0 ? (app.stage === "Declined" && i <= 4 ? "complete" : "upcoming") : i < index ? "complete" : i === index ? "current" : "upcoming",
            }))}
          />
        </CardContent>
      </Card>

      <Grid columns={{ base: 1, lg: 3 }} gap="large">
        <div className="lg:col-span-2">
          <Stack gap="large">
            <Card>
              <CardHeader>
                <CardTitle>Facility request</CardTitle>
              </CardHeader>
              <CardContent>
                <DescriptionList
                  columns={3}
                  items={[
                    { label: "Product", value: app.product },
                    { label: "Fast-Track variant", value: variant?.label },
                    { label: "Request type", value: app.requestType },
                    { label: "Amount", value: money(app.amount), mono: true },
                    { label: "Tenor", value: `${app.tenorMonths} months`, mono: true },
                    { label: "Chart-flow", value: app.flow, status: app.flow, statusTones: { "Fast-Track": "accent", Standard: "neutral" } },
                    { label: "Purpose", value: app.purpose, span: 3 },
                    { label: "Initiated by", value: creator ? `${creator.name} · ${roleById[creator.roleId].name}` : "—" },
                    { label: "Initiated", value: dateTime(app.createdAt) },
                    { label: "Last updated", value: dateTime(app.updatedAt) },
                    { label: "SLA due", value: date(app.slaDueAt), hint: new Date(app.slaDueAt) < DEMO_NOW ? "Past the tenant SLA target" : undefined },
                    { label: "Recommendation", value: app.recommendation ? recommendationLabel[app.recommendation] : undefined, status: app.recommendation ? recommendationLabel[app.recommendation] : undefined, statusTones: recommendationLabelTones },
                    { label: "Covenants tagged", value: String(app.covenants.length), mono: true },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Obligor</CardTitle>
              </CardHeader>
              <CardContent>
                <DescriptionList
                  columns={3}
                  items={[
                    { label: "Name", value: obligor.name },
                    { label: "Obligor ID", value: obligor.id, mono: true, copyValue: obligor.id },
                    { label: "Type", value: obligor.type },
                    { label: "Sector", value: sector?.name },
                    { label: obligor.rcNumber ? "RC number" : "BVN", value: obligor.rcNumber ?? obligor.bvnMasked, mono: true },
                    { label: "Branch / state", value: `${obligor.branch} · ${obligor.state}` },
                    { label: "Customer since", value: date(obligor.customerSince) },
                    { label: "Relationship manager", value: rm?.name },
                    { label: "Internal risk grade", value: `${obligor.riskGrade} / 10`, mono: true },
                    { label: "Watchlist", value: obligor.watchlist ? "On watchlist" : "Not on watchlist", status: obligor.watchlist ? "Watchlist" : "Clear", statusTones: { Watchlist: "warning", Clear: "success" } },
                    { label: "Existing facilities", value: String(c.facilities.filter((f) => f.obligorId === obligor.id && f.status !== "Closed" && f.applicationId !== app.id).length), mono: true },
                  ]}
                />
              </CardContent>
            </Card>

            <AiDraftPanel
              title="AI-drafted credit memo summary"
              model="Credigit Risk Copilot (simulated)"
              generatedAt={dateTime(app.updatedAt)}
              confidence={0.82}
              draft={memo?.text ?? draftMemo(c)}
              sources={[
                { label: "Audited financial statements (OCR)", detail: "" },
                { label: "CBA and other-bank statements", detail: "" },
                { label: "Bureau and CRMS reports", detail: "" },
                { label: "360 RAR position", detail: "" },
              ]}
              signedOffBy={memo ? `Signed off by ${memo.by} on ${dateTime(memo.at)}${memo.edited ? " (edited)" : ""}` : undefined}
              signOffNote={canSign ? undefined : "AI output is advisory. The Credit Analyst or CCO must review, edit and sign off before it is used in the credit memo."}
              onAccept={
                canSign
                  ? (text) => {
                      const edited = text.trim() !== draftMemo(c).trim();
                      void recordChange(app.id, { point: "memo.sign-off", event: "origination.memo.signed-off", action: edited ? "Edited and signed off AI-drafted credit memo" : "Signed off AI-drafted credit memo", after: "Human sign-off", payload: { edited } }).then((r) => {
                        if (r.ok) c.patchExtra({ memo: { text, by: c.me.name, at: new Date().toISOString(), edited } });
                      });
                    }
                  : undefined
              }
            />
          </Stack>
        </div>

        <Stack gap="large">
          <ChecklistPanel title="Pre-approval gates" description="Checked automatically before the request can move to the next tier." items={gateItems(c)} />
          <Card>
            <CardHeader>
              <CardTitle>Related</CardTitle>
            </CardHeader>
            <CardContent>
              <Stack gap="small">
                <TextLink as={Link} href={`/credit-analysis/assessment/?id=${obligor.id}`}>360 RAR assessment for {obligor.name}</TextLink>
                <TextLink as={Link} href="/origination/chart-flows/">Approval chart-flows</TextLink>
                {["Offer", "Conditions", "Disbursement", "Booked"].includes(app.stage) ? (
                  <TextLink as={Link} href={`/offer-letters/letter/?applicationId=${app.id}`}>Offer letter</TextLink>
                ) : null}
                <TextLink as={Link} href="/collateral/">Collateral register</TextLink>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      </Grid>
    </Stack>
  );
}
