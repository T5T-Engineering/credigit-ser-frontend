"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { BackendOperationPage } from "@/modules/operations/backend-operations";
import { OperationItemPage } from "@/modules/operations/item-page";

/** Backend Operations ids: "OPS-" + 32 hex characters (frontend ids are shorter base-36). */
const backendOperationId = /^OPS-[0-9a-f]{32}$/;

function Item() {
  // Platform requests (users, roles, permissions, groups) live in the backend Operations engine.
  const params = useSearchParams();
  const platform = params.get("source") === "platform" || backendOperationId.test(params.get("id") ?? "");
  return platform ? <BackendOperationPage /> : <OperationItemPage />;
}

export default function Page() {
  return (
    <Suspense>
      <Item />
    </Suspense>
  );
}
