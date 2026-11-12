"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BriefcaseBusiness, FileSearch, Radar } from "lucide-react";
import { Button, EmptyState, EntityHeader, PermissionGate, Spinner, Stack, Tabs } from "@credigit/web-ui";
import { useCan } from "@/lib/iam/permissions";
import { useApplication, useUsers } from "@/lib/data/hooks";
import { date, money } from "@/lib/format";
import { roleById } from "@/lib/rbac/roles";
import { stageTones, slaState, chainStatus } from "../logic";
import { useApplicationContext } from "../application/context";
import { NextStepCard } from "../application/next-step";
import { OverviewTab } from "../application/overview-tab";
import { FinancialsTab } from "../application/financials-tab";
import { RarTab } from "../application/rar-tab";
import { DocumentsTab, useOcrCompletion } from "../application/documents-tab";
import { CollateralTab } from "../application/collateral-tab";
import { RecommendationTab } from "../application/recommendation-tab";
import { ApprovalsTab } from "../application/approvals-tab";
import { ActivityTab, CommentsTab } from "../application/discussion-tabs";

export function ApplicationRecordPage() {
  return (
    <Suspense fallback={<Spinner label="Loading application" />}>
      <ApplicationRecord />
    </Suspense>
  );
}

function ApplicationRecord() {
  const params = useSearchParams();
  const id = params.get("id");
  const app = useApplication(id);
  const c = useApplicationContext(app);
  const users = useUsers();
  const allowed = useCan(["origination.applications.view", "origination.applications.view-mine"]);
  const [tab, setTab] = useState(params.get("tab") ?? "overview");
  useOcrCompletion(c?.docs ?? []);

  if (!allowed) return <PermissionGate allowed={false} description="Your role doesn't include loan origination. Switch role from the user menu to see it.">{null}</PermissionGate>;
  if (!app || !c) {
    return (
      <EmptyState
        icon={<FileSearch aria-hidden />}
        title="Application not found"
        description={id ? `No application with ID ${id} exists in this tenant. It may have been removed or the demo data reset.` : "No application ID was given."}
        action={<Button as={Link} href="/origination/">Back to applications</Button>}
      />
    );
  }

  const ao = users.find((u) => u.id === app.createdById);
  const sla = slaState(app);
  const status = chainStatus(app.approvals);

  return (
    <Stack gap="large">
      <EntityHeader
        back={{ href: "/origination/", label: "Applications" }}
        linkComponent={Link}
        eyebrow={`${app.flow} credit · ${app.requestType}`}
        title={c.obligor.name}
        subtitle={app.purpose}
        identifier={app.id}
        identifierLabel="Application ID"
        media={<BriefcaseBusiness aria-hidden />}
        status={{ status: app.stage, tones: stageTones }}
        facts={[
          { label: "Amount", value: money(app.amount), mono: true },
          { label: "Product", value: app.product },
          { label: "Tenor", value: `${app.tenorMonths} months`, mono: true },
          { label: "Approval route", value: app.stage === "Approval" && status === "Approved" ? "Fully approved" : `${app.approvals.filter((s) => s.decision !== "pending").length} of ${app.approvals.length} steps` },
          { label: "SLA due", value: sla === "Closed" ? "Closed" : `${date(app.slaDueAt)} · ${sla}` },
          { label: "Account Officer", value: ao ? `${ao.name} (${roleById[ao.roleId].short})` : "—" },
        ]}
        actions={
          <Button as={Link} href={`/credit-analysis/assessment/?id=${c.obligor.id}`} variant="tertiary" iconBefore={<Radar aria-hidden />}>
            360 RAR assessment
          </Button>
        }
      />

      <NextStepCard c={c} onOpenTab={setTab} />

      <Tabs
        label="Application sections"
        variant="underline"
        value={tab}
        onValueChange={setTab}
        items={[
          { id: "overview", label: "Overview", content: <OverviewTab c={c} /> },
          { id: "financials", label: "Financials & COP", content: <FinancialsTab c={c} /> },
          { id: "rar", label: "360 RAR", content: <RarTab c={c} /> },
          { id: "documents", label: "Documents", badge: String(c.docs.length), content: <DocumentsTab c={c} /> },
          { id: "collateral", label: "Collateral", badge: String(c.collateral.length), content: <CollateralTab c={c} /> },
          { id: "recommendation", label: "Recommendation & covenants", content: <RecommendationTab c={c} /> },
          { id: "approvals", label: "Approvals", content: <ApprovalsTab c={c} /> },
          { id: "comments", label: "Comments", badge: c.comments.length ? String(c.comments.length) : undefined, content: <CommentsTab c={c} /> },
          { id: "activity", label: "Activity", content: <ActivityTab c={c} /> },
        ]}
      />
    </Stack>
  );
}
