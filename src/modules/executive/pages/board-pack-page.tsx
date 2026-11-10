"use client";

import Link from "next/link";
import { FileStack, Send } from "lucide-react";
import { Alert, Button, ChecklistPanel, DataTable, Grid, Stack, StatusBadge, Text } from "@credigit/web-ui";
import { ModulePage } from "@/components/module-page";
import { useCan } from "@/lib/auth/session";
import { dateTime } from "@/lib/format";
import { useRule } from "@/lib/platform/rules";
import { operationHref, PendingApproval, RulesPanel } from "@/modules/portfolio/components/governance";
import { Panel } from "@/modules/portfolio/components/panel";
import { useExecutiveGovernance } from "../hooks";
import { EXEC_RULES } from "../platform";

const tones = {
  "AI-drafted — awaiting validation": "warning",
  Validated: "info",
  "Submitted for release": "brand",
  "Returned for correction": "danger",
  Released: "success",
  Generating: "info",
} as const;

/** Board Risk Committee pack (§6.6.6, §6.11): build the draft, check sections, submit for approval through Operations. */
export function BoardPackPage() {
  const canEdit = useCan("executive", "edit");
  const gov = useExecutiveGovernance();
  const needsSummary = useRule<boolean>(EXEC_RULES.packRequiresSignedSummary);
  const { brcRun, packRuns, packItems, signOff } = gov;

  return (
    <ModulePage
      module="executive"
      title="Board Risk Committee pack"
      description="Pack builder for the Board Risk Committee (§6.6.6, §6.11): sections pulled from each module, the signed-off executive summary, and approval for issue through the Operations workflow."
      actions={
        <Button as={Link} href="/executive" variant="tertiary" size="small">
          Back to executive view
        </Button>
      }
    >
      <Stack gap="large">
        {needsSummary && !signOff ? (
          <Alert tone="warning" title={`The ${gov.period} executive summary isn't signed off yet`}>
            The pack can be built, but it can only be submitted for approval once the executive risk summary is signed off (business rule).{" "}
            <Link href="/executive" className="font-semibold text-link">Open the executive summary</Link>
          </Alert>
        ) : null}
        {brcRun?.status === "Returned for correction" ? (
          <Alert tone="danger" title="Pack returned">{brcRun.returnReason || "The approver didn't approve this pack."} Update the sections and submit again.</Alert>
        ) : null}

        <Grid columns={{ base: 1, lg: 3 }} gap="medium">
          <div className="lg:col-span-2">
            <Stack gap="medium">
              <Panel title={`${gov.period} pack`} description={brcRun ? `Run ${brcRun.id} · prepared by ${brcRun.generatedBy} · ${dateTime(brcRun.generatedAt)}` : "No pack built for this period yet."}>
                <Stack gap="medium">
                  {brcRun ? (
                    <Text variant="small">
                      Status: <StatusBadge status={brcRun.status} tones={tones} />
                      {brcRun.releasedBy ? ` · approved by ${brcRun.releasedBy}${brcRun.releasedAt ? `, ${dateTime(brcRun.releasedAt)}` : ""}` : ""}
                    </Text>
                  ) : null}
                  {canEdit ? (
                    <div className="flex flex-wrap gap-2">
                      {!brcRun ? (
                        <Button size="small" variant="primary" iconBefore={<FileStack size={14} aria-hidden />} onClick={() => void gov.buildPack()}>
                          Build {gov.period} pack
                        </Button>
                      ) : null}
                      {gov.canSubmitPack ? (
                        <Button size="small" variant="primary" iconBefore={<Send size={14} aria-hidden />} onClick={() => void gov.submitPack()}>
                          Submit pack for approval
                        </Button>
                      ) : null}
                      {brcRun?.operationId ? (
                        <Button as={Link} href={operationHref(brcRun.operationId)} size="small" variant="secondary">
                          Open in Operations
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <Text variant="small">The pack is built and submitted by the CRO or Head of Risk. Your role can review it.</Text>
                  )}
                  {brcRun ? <PendingApproval subjectType="BoardPack" subjectId={brcRun.id} /> : null}
                </Stack>
              </Panel>
              <Panel title="Pack history" description="Every Board Risk Committee pack run, with who prepared and approved it.">
                <DataTable
                  label="Board Risk Committee packs"
                  data={packRuns}
                  getRowId={(r) => r.id}
                  paginate={false}
                  exportFilename="brc-pack-history.csv"
                  columns={[
                    { id: "id", header: "Run", accessor: "id", cell: (r) => <span className="font-mono text-fg">{r.id}</span> },
                    { id: "period", header: "Period", accessor: "period" },
                    { id: "status", header: "Status", accessor: "status", cell: (r) => <StatusBadge status={r.status} tones={tones} /> },
                    { id: "by", header: "Prepared by", accessor: "generatedBy" },
                    { id: "rel", header: "Approved by", accessor: (r) => r.releasedBy ?? "", cell: (r) => r.releasedBy ?? "—" },
                    { id: "at", header: "Generated", accessor: "generatedAt", cell: (r) => dateTime(r.generatedAt) },
                  ]}
                />
              </Panel>
            </Stack>
          </div>
          <ChecklistPanel title="Pack sections" description="Sections pulled from each module." items={packItems} />
        </Grid>

        <RulesPanel title="Board reporting rules" keys={[EXEC_RULES.packRequiresSignedSummary, EXEC_RULES.packNotifyRoles, EXEC_RULES.summaryNotifyRoles]} />
      </Stack>
    </ModulePage>
  );
}
