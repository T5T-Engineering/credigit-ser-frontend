"use client";

import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ChipList, Chip, Grid, Stack, Steps, Text } from "@credigit/web-ui";
import { roleById, type RoleId } from "@/lib/rbac/roles";

const lines: { title: string; description: string; roles: RoleId[]; note?: string }[] = [
  { title: "First line — risk-taking", description: "Front Office / Account Officers own the risks they originate and operate day-to-day controls.", roles: ["account-officer", "bdm"] },
  {
    title: "Second line — risk oversight",
    description: "Risk officer roles set policy, monitor and challenge the first line.",
    roles: ["credit-admin-officer", "loan-review-officer", "middle-office-officer", "collateral-officer", "predictive-analytics-officer", "operational-risk-analyst", "market-risk-analyst", "portfolio-mis-officer"],
  },
  { title: "Third line — independent assurance", description: "Internal Audit, independent of both — where the tenant operates one.", roles: [], note: "No Internal Audit role is configured for this tenant. A read-only audit role can be added in Users & roles (§4.0)." },
];

export function LinesOfDefenceSection() {
  return (
    <Stack gap="large">
      <Grid columns={{ base: 1, lg: 3 }} gap="large">
        {lines.map((l, i) => (
          <Card key={l.title}>
            <CardHeader>
              <Badge tone={i === 0 ? "accent" : i === 1 ? "info" : "neutral"}>Line {i + 1}</Badge>
              <CardTitle className="mt-2">{l.title}</CardTitle>
              <CardDescription>{l.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {l.roles.length ? (
                <ChipList>
                  {l.roles.map((r) => (
                    <Chip key={r} size="small">{roleById[r].name}</Chip>
                  ))}
                </ChipList>
              ) : (
                <Text variant="small" tone="muted">{l.note}</Text>
              )}
            </CardContent>
          </Card>
        ))}
      </Grid>
      <Grid columns={{ base: 1, lg: 2 }} gap="large">
        <Card>
          <CardHeader>
            <CardTitle>Risk-function reporting hierarchy</CardTitle>
            <CardDescription>The CRO sits above the Head of Risk and is the final risk-side escalation point before the Board Risk Committee (§4.3)</CardDescription>
          </CardHeader>
          <CardContent>
            <Steps
              items={[
                { title: "Board Risk Committee", description: "Notified of material breaches; receives the BRC pack" },
                { title: "Chief Risk Officer", description: "Owns the enterprise Risk Appetite Statement; apex risk-module authority" },
                { title: "Head of Risk", description: "Cross-functional risk policy, escalation handling, BRC pack preparation" },
                { title: "Risk officer roles (second line)", description: "Operational, market, credit-admin, loan review, collateral, analytics, MIS" },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Framework alignment</CardTitle>
            <CardDescription>§9.2 global best-practice frameworks</CardDescription>
          </CardHeader>
          <CardContent>
            <Stack gap="small">
              {[
                ["COSO ERM", "Risk appetite scorecard, exception escalation, KRI framework and RCSA follow identify-assess-respond-monitor."],
                ["ISO 31000", "Risk treatment is monitored to a defined closure, not merely flagged (four-level escalation)."],
                ["Three Lines of Defence", "Role-to-line mapping above; which roles exist and how they map is tenant-configurable (§4.0)."],
                ["BCBS 239", "Single Risk Data Spine; every figure drillable to source."],
                ["ISO 22301", "BCM plan currency and crisis-readiness tracking."],
              ].map(([t, d]) => (
                <div key={t} className="rounded-3xl bg-surface-sunken p-3">
                  <div className="text-sm font-semibold text-fg">{t}</div>
                  <Text variant="small" tone="muted">{d}</Text>
                </div>
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Grid>
    </Stack>
  );
}
