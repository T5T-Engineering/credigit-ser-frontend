import type { ReactNode } from "react";

/** Page frame for unauthenticated screens (layout only; the card itself comes from @credigit/web-ui). */
export function AuthShell({ children }: { children: ReactNode }) {
  return <main className="grid min-h-dvh place-items-center bg-surface-sunken px-4 py-10">{children}</main>;
}
