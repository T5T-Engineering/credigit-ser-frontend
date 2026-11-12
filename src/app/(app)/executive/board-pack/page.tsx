"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@credigit/web-ui";
import { PACK_HREF } from "@/modules/executive/platform";

/**
 * Legacy route. The Board Risk Committee pack has one flow, owned by enterprise-risk; this route only
 * redirects (static export has no server redirects).
 */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace(PACK_HREF);
  }, [router]);
  return <Spinner label="Opening the Board Risk Committee pack" />;
}
