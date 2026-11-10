"use client";

import { Suspense } from "react";
import { Spinner } from "@credigit/web-ui";
import { CollateralItemPage } from "@/modules/collateral/pages/item-page";

export default function Page() {
  return (
    <Suspense fallback={<Spinner label="Loading collateral record" />}>
      <CollateralItemPage />
    </Suspense>
  );
}
