"use client";

/** Raise-exception dialog (composition of library parts). Used by monitoring, collateral and share-collateral pages. */
import { useState } from "react";
import { Alert, Button, Field, Form, Modal, Select, Stack, Text, Textarea } from "@credigit/web-ui";
import { useAuditLog, useActor } from "./audit";
import { escalationLadder, exceptionTypes, type ExceptionType } from "./logic";
import { useMonitoring, type MonitoringException } from "./store";

export type RaiseExceptionTarget = {
  obligorId: string;
  obligorName: string;
  facilityId?: string;
  collateralId?: string;
  amount?: number;
  type: ExceptionType;
  title: string;
  detail: string;
  source?: MonitoringException["source"];
};

export function RaiseExceptionModal({ target, onClose, onRaised }: { target: RaiseExceptionTarget | null; onClose: () => void; onRaised?: (e: MonitoringException) => void }) {
  return target ? <RaiseExceptionInner key={`${target.obligorId}-${target.facilityId}-${target.collateralId}-${target.type}`} target={target} onClose={onClose} onRaised={onRaised} /> : null;
}

function RaiseExceptionInner({ target, onClose, onRaised }: { target: RaiseExceptionTarget; onClose: () => void; onRaised?: (e: MonitoringException) => void }) {
  const raise = useMonitoring((s) => s.raise);
  const audit = useAuditLog();
  const actor = useActor();
  const [type, setType] = useState<ExceptionType>(target.type);
  const [detail, setDetail] = useState(target.detail);

  const submit = () => {
    const ex = raise({
      type,
      title: target.title,
      detail,
      obligorId: target.obligorId,
      facilityId: target.facilityId,
      collateralId: target.collateralId,
      amount: target.amount,
      source: target.source ?? "Manual",
      assigneeId: actor.roleId === "loan-review-officer" ? actor.id : undefined,
      by: actor.name,
    });
    audit({ action: "Raised exception", entityType: "Exception", entityId: ex.id, after: `${type} · Level 1 · ${target.facilityId ?? target.collateralId ?? target.obligorId}` });
    onRaised?.(ex);
    onClose();
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Raise exception"
      description={`${target.obligorName}${target.facilityId ? ` · ${target.facilityId}` : ""}${target.collateralId ? ` · ${target.collateralId}` : ""}`}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={detail.trim().length < 5}>
            Raise at Level 1
          </Button>
        </>
      }
    >
      <Form onSubmit={(e) => (e.preventDefault(), submit())}>
        <Field label="Exception type" htmlFor="exc-type">
          <Select id="exc-type" value={type} onChange={(e) => setType(e.target.value as ExceptionType)} options={exceptionTypes.map((t) => ({ value: t, label: t }))} />
        </Field>
        <Field label="Details" htmlFor="exc-detail" description="What was detected and what cure is expected.">
          <Textarea id="exc-detail" rows={4} value={detail} onChange={(e) => setDetail(e.target.value)} />
        </Field>
        <Alert tone="info" title="Escalation protocol (PRD §6.4.4)">
          <Stack gap="xsmall">
            <Text variant="small">Level 1 notifies: {escalationLadder[0]!.notified}. Dashboard and email fire together to the named officers.</Text>
            <Text variant="small">The exception stays open until cured and evidenced — it is never allowed to go silent.</Text>
          </Stack>
        </Alert>
      </Form>
    </Modal>
  );
}
