/**
 * Deployment environment label shown in the app shell (sidebar and header badge), from environment config
 * `NEXT_PUBLIC_APP_ENVIRONMENT` (e.g. "Development", "UAT", "Staging"). Empty or unset: no label is shown,
 * which is the expected setting for production. Build-time value; rebuild after changing it.
 */
export const appEnvironment = (process.env.NEXT_PUBLIC_APP_ENVIRONMENT ?? "").trim();
