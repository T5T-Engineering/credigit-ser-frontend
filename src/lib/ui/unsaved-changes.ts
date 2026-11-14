"use client";

import { useEffect } from "react";

/**
 * While `dirty`, refreshing or closing the tab asks the browser to confirm, so edits that only live in page state
 * (permission toggles, unsaved forms) are not lost silently.
 */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
