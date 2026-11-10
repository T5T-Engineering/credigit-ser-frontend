/** Formatting helpers (en-NG). Figures are rendered with `font-mono` (tabular numbers) in tables and KPIs. */
import { format, formatDistanceToNowStrict } from "date-fns";

const ngn = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });

/** ₦1,250,000 */
export function money(value: number, currency: "NGN" | "USD" = "NGN"): string {
  return (currency === "USD" ? usd : ngn).format(value);
}

/** Compact naira: ₦1.25bn, ₦450m, ₦12.5k */
export function moneyShort(value: number, currency: "NGN" | "USD" = "NGN"): string {
  const sign = currency === "USD" ? "$" : "₦";
  const abs = Math.abs(value);
  const neg = value < 0 ? "-" : "";
  if (!Number.isFinite(value)) return "No limit";
  if (abs >= 1e12) return `${neg}${sign}${trim(abs / 1e12)}trn`;
  if (abs >= 1e9) return `${neg}${sign}${trim(abs / 1e9)}bn`;
  if (abs >= 1e6) return `${neg}${sign}${trim(abs / 1e6)}m`;
  if (abs >= 1e3) return `${neg}${sign}${trim(abs / 1e3)}k`;
  return `${neg}${sign}${num.format(abs)}`;
}

function trim(n: number) {
  return n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1).replace(/\.0$/, "") : n.toFixed(2).replace(/\.?0+$/, "");
}

export function number(value: number): string {
  return num.format(value);
}

export function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function date(value: string | Date): string {
  return format(new Date(value), "d MMM yyyy");
}

export function dateTime(value: string | Date): string {
  return format(new Date(value), "d MMM yyyy, HH:mm");
}

export function ago(value: string | Date): string {
  return `${formatDistanceToNowStrict(new Date(value))} ago`;
}
