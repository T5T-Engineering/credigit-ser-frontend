"use client";

/** Live tenant parameters from Admin → Rules & parameters, with the module's demo defaults as fallback. */
import { useAdminParams } from "@/modules/admin/store";
import { collateralHaircuts, originationParams } from "./params";

export function useStepUpThreshold(): number {
  const p = useAdminParams();
  return p?.stepUpThresholdNgn ?? originationParams.highValueThreshold;
}

export function useHaircuts() {
  const p = useAdminParams();
  return p?.haircuts ?? collateralHaircuts;
}
