"use client";

import { useCallback, useMemo } from "react";
import { usePermissionSet, type PermissionKey, type PermissionRequirement } from "@/lib/iam/permissions";
import { useCollateral, useDbActions, useDocuments, useFacilities, useObligors, useSectors, useUsers } from "@/lib/data/hooks";
import type { Application, Collateral, DocumentRecord, Facility, Obligor, Sector, User } from "@/lib/data/types";
import type { RoleId } from "@/lib/rbac/roles";
import { bureauAdverse, bureauReports, reconciliation, seedComments, useExtra, useOriginationStore, type ApplicationExtra, type BureauReport, type OriginationComment, type Reconciliation } from "../data";
import { lendingValue, limitGate, runEngine, tagCovenants, type EngineOutput, type LibraryClause, type LimitGateResult } from "../logic";
import { useMe } from "../use-me";
import { useRulesVersion } from "../use-params";

export type AppCtx = {
  app: Application;
  obligor: Obligor;
  sector?: Sector;
  docs: DocumentRecord[];
  collateral: Collateral[];
  facilities: Facility[];
  users: User[];
  me: User;
  roleId?: RoleId;
  /** Whether the signed-in user holds the permission (any of, for a list). Tabs use this with the key of the action they guard. */
  can: (required: PermissionRequirement) => boolean;
  /**
   * True when the user holds at least one origination action permission. Kept for tabs that have not yet moved to
   * `can(key)`; new code must check the specific action key instead.
   */
  canEdit: boolean;
  extra: ApplicationExtra;
  comments: OriginationComment[];
  rec: Reconciliation;
  bureau: BureauReport[];
  adverse: boolean;
  gate: LimitGateResult;
  engine: EngineOutput;
  clauses: LibraryClause[];
  coverage: number;
  lendingTotal: number;
  /** Update the application and write the audit log in one go. */
  change: (changes: Partial<Application>, action: string, before?: string, after?: string) => void;
  patchExtra: (changes: Partial<ApplicationExtra>) => void;
  log: (action: string, before?: string, after?: string, entityType?: string, entityId?: string) => void;
};

/** Origination action permissions on an application record (view keys excluded). */
const ORIGINATION_ACTION_KEYS = [
  "origination.analysis.complete",
  "origination.analysis.record",
  "origination.applications.release-to-offer",
  "origination.applications.submit",
  "origination.applications.update",
  "origination.applications.withdraw",
  "origination.approvals.submit",
  "origination.bureau-checks.run",
  "origination.comments.create",
  "origination.cop-explanations.update",
  "origination.covenants.update",
  "origination.credit-memos.sign-off",
  "origination.documents.upload",
  "origination.documents.verify",
  "origination.limit-exceptions.request",
  "origination.limit-gate.run",
  "origination.recommendations.adopt",
  "origination.recommendations.request-override",
] as const satisfies readonly PermissionKey[];

export function useApplicationContext(app: Application | undefined): AppCtx | undefined {
  const obligors = useObligors();
  const sectors = useSectors();
  const docsAll = useDocuments();
  const collateralAll = useCollateral();
  const facilities = useFacilities();
  const users = useUsers();
  const { user: me, roleId } = useMe();
  const permissions = usePermissionSet();
  const can = useCallback(
    (required: PermissionRequirement) => (typeof required === "string" ? [required] : required).some((k) => permissions.has(k)),
    [permissions],
  );
  const canEdit = can(ORIGINATION_ACTION_KEYS);
  const extra = useExtra(app?.id);
  const patch = useOriginationStore((s) => s.patch);
  const db = useDbActions();
  const rulesVersion = useRulesVersion();

  const log = useCallback(
    (action: string, before?: string, after?: string, entityType = "Application", entityId?: string) => {
      if (!app || !roleId) return;
      db.log({ actorId: me.id, actorName: me.name, roleId, action, entityType, entityId: entityId ?? app.id, before, after });
    },
    [app, db, me, roleId],
  );
  const change = useCallback(
    (changes: Partial<Application>, action: string, before?: string, after?: string) => {
      if (!app) return;
      db.update("applications", app.id, { ...changes, updatedAt: new Date().toISOString() });
      log(action, before, after);
    },
    [app, db, log],
  );
  const patchExtra = useCallback((changes: Partial<ApplicationExtra>) => app && patch(app.id, changes), [app, patch]);

  return useMemo(() => {
    if (!app) return undefined;
    const obligor = obligors.find((o) => o.id === app.obligorId);
    if (!obligor) return undefined;
    const docs = docsAll.filter((d) => app.documentIds.includes(d.id) || (d.ownerType === "application" && d.ownerId === app.id));
    const collateral = collateralAll.filter((c) => app.collateralIds.includes(c.id));
    const lendingTotal = collateral.reduce((s, c) => s + lendingValue(c), 0);
    const coverage = app.amount ? lendingTotal / app.amount : 0;
    const bureau = bureauReports(obligor, facilities, extra.bureauRunAt);
    const adverse = bureauAdverse(bureau);
    const gate = limitGate({ id: app.id, product: app.product, amount: app.amount, obligorId: app.obligorId }, obligor, facilities, obligors, sectors);
    const engine = runEngine({ obligor, copRatio: app.copRatio, copExplained: Boolean(extra.copExplanation), limitGate: app.limitGate, bureauAdverse: adverse, coverage });
    const clauses = tagCovenants({ product: app.product, obligor, tenorMonths: app.tenorMonths, collateral, position: engine.position, variant: extra.variant });
    return {
      app,
      obligor,
      sector: sectors.find((s) => s.id === obligor.sectorId),
      docs,
      collateral,
      facilities,
      users,
      me,
      roleId,
      can,
      canEdit,
      extra,
      comments: extra.comments ?? seedComments(app.id, app, users),
      rec: reconciliation(obligor),
      bureau,
      adverse,
      gate,
      engine,
      clauses,
      coverage,
      lendingTotal,
      change,
      patchExtra,
      log,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- business rules are read at call time; re-derive when they change
  }, [app, obligors, sectors, docsAll, collateralAll, facilities, users, me, roleId, can, canEdit, extra, change, patchExtra, log, rulesVersion]);
}
