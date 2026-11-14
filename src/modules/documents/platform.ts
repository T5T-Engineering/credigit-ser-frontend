"use client";

/**
 * Platform registrations for the Documents screens (backend DMS, ADR-0021). The backend owns the DMS rules, Operations types, templates,
 * events and hooks; the browser only needs the upload size fallback for the file picker (the backend re-checks every upload).
 */
import { defineRules } from "@/lib/platform/rules";

defineRules([
  {
    key: "documents.maxUploadMb",
    label: "Upload size limit",
    description: "Largest file (MB) a document type accepts when the type sets no limit of its own. The file picker uses it; the backend enforces it.",
    module: "documents",
    category: "Documents",
    type: "number",
    unit: "MB",
    default: 25,
    min: 1,
    max: 500,
    source: "Backend rule documents.maxUploadMb (ADR-0021)",
  },
]);
