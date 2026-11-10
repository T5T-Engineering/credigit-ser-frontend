"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@credigit/web-ui";
import { useHydrated, useSession } from "@/lib/auth/session";

/** Entry: send signed-in users to their dashboard, everyone else to sign-in. */
export default function Home() {
  const router = useRouter();
  const hydrated = useHydrated();
  const user = useSession((s) => s.user);
  useEffect(() => {
    if (hydrated) router.replace(user ? "/dashboard/" : "/login/");
  }, [hydrated, user, router]);
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner label="Loading" />
    </div>
  );
}
