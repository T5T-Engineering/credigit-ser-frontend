import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@credigit/web-ui";
import { CalcNote, type CalcNoteProps } from "./calc-note";

export type PanelProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Formula/source note shown beside the title. */
  calc?: CalcNoteProps;
  /** Right-aligned header actions (e.g. a SegmentedControl). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Card with title, description, optional calc note and actions — the standard chart/table panel. */
export function Panel({ title, description, calc, actions, children, className }: PanelProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <CardTitle>{title}</CardTitle>
              {calc ? <CalcNote {...calc} /> : null}
            </div>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
