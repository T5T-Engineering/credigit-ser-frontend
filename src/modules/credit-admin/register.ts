/**
 * Facility register groupings (PRD §6.3.1): facility classes across on- and off-balance-sheet products,
 * and the Application-Type register (New / Renewal / Restructure / Enhancement).
 */
import type { ProductType } from "@/lib/data/types";

export type FacilityClass = "Advances" | "Loans" | "Leases" | "Overdrafts" | "Contingent liabilities";

export const facilityClassOf: Record<ProductType, FacilityClass> = {
  "Term loan": "Loans",
  Mortgage: "Loans",
  "Asset finance": "Loans",
  "Revolving credit": "Advances",
  "Invoice discounting": "Advances",
  "Lease finance": "Leases",
  Overdraft: "Overdrafts",
  "Trade finance (LC)": "Contingent liabilities",
  "Bank guarantee": "Contingent liabilities",
  "Advance payment guarantee": "Contingent liabilities",
};

export const facilityClasses: FacilityClass[] = ["Advances", "Loans", "Leases", "Overdrafts", "Contingent liabilities"];

/** Application stages counted as "in process" in the Application-Type register. */
export const inProcessStages = ["Documents", "Analysis", "Recommendation", "Approval", "Offer", "Conditions", "Disbursement"] as const;
