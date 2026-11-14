"use client";

import { showResult, useToast, type ToastOptions } from "@credigit/web-ui";

/**
 * Outcome feedback for saves and commands. Same `toast(options)` call as the library's `useToast()`, but a successful (or
 * warning) outcome opens the `ResultDialog` popup so it can't be missed; failures and neutral notices stay toasts.
 */
export function useSaveFeedback() {
  const { toast, dismiss, toasts } = useToast();
  const notify = (options: ToastOptions) => {
    if (options.tone === "success" || options.tone === "warning") {
      showResult({ tone: options.tone, title: options.title, description: options.description, action: options.action });
      return options.id ?? "";
    }
    return toast(options);
  };
  return { toast: notify, dismiss, toasts };
}
