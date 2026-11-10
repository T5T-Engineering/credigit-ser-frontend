"use client";

import { AuditTrail, Card, CardContent, CommentThread } from "@credigit/web-ui";
import { useAudit } from "@/lib/data/hooks";
import { dateTime } from "@/lib/format";
import { roleById } from "@/lib/rbac/roles";
import { toActivityItem } from "../view-models";
import type { AppCtx } from "./context";
import { addComment } from "../actions";

export function CommentsTab({ c }: { c: AppCtx }) {
  return (
    <Card>
      <CardContent>
        <CommentThread
          title="Credit committee discussion"
          comments={c.comments.map((m) => ({ id: m.id, author: { name: m.authorName, role: roleById[m.roleId]?.name }, body: m.body, time: dateTime(m.at), internal: m.internal }))}
          currentUser={{ name: c.me.name, role: c.roleId ? roleById[c.roleId].name : undefined }}
          mentions={c.users.map((u) => u.name.split(" ")[0]!)}
          placeholder="Add a comment — use @name to mention a colleague"
          onSubmit={
            c.roleId
              ? (body) => {
                  const comment = { id: `${c.app.id}-c${Date.now().toString(36)}`, authorId: c.me.id, authorName: c.me.name, roleId: c.roleId!, body, at: new Date().toISOString() };
                  void addComment(c.app.id, body, c.users).then((r) => {
                    if (r.ok) c.patchExtra({ comments: [...c.comments, comment] });
                  });
                }
              : undefined
          }
        />
      </CardContent>
    </Card>
  );
}

export function ActivityTab({ c }: { c: AppCtx }) {
  const audit = useAudit();
  const items = audit.filter((e) => e.entityId === c.app.id || c.app.documentIds.includes(e.entityId)).map(toActivityItem);
  return (
    <Card>
      <CardContent>
        <AuditTrail items={items} emptyMessage="No recorded activity for this application yet." />
      </CardContent>
    </Card>
  );
}
