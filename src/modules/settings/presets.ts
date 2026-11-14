import type { BrandPreset } from "@credigit/web-ui";

/**
 * Tenant brand presets offered on Settings → Branding. Hex values are tenant brand CONFIGURATION (data handed to
 * `updateBrand` through the library's preset picker), not UI styling. Harbourline, Sahel and Atlantic are fictional
 * demo tenants. TECH-DEBT TD-801: should come from tenant configuration (brand catalogue API), not app code.
 */
export const brandPresets: BrandPreset[] = [
  { id: "credigit", name: "Credigit default", description: "Ink, Ember and Slate", brand: { name: "Credigit", colors: { primary: "#0F1E2E", accent: "#E8401C", neutral: "#5B6878" }, font: { family: "Baloo 2" } } },
  { id: "harbourline", name: "Harbourline Bank", description: "Navy and teal", brand: { name: "Harbourline Bank", colors: { primary: "#0B2545", accent: "#0F766E", neutral: "#52606D" }, font: { family: "Inter" } } },
  { id: "sahel", name: "Sahel Microfinance Bank", description: "Aubergine and magenta", brand: { name: "Sahel Microfinance Bank", colors: { primary: "#2E1A47", accent: "#A21C6B", neutral: "#5E5A6B" }, font: { family: "Nunito Sans" } } },
  { id: "atlantic", name: "Atlantic Merchant Bank", description: "Forest and green", brand: { name: "Atlantic Merchant Bank", colors: { primary: "#14241C", accent: "#1D6B3A", neutral: "#56635B" }, font: { family: "IBM Plex Sans" } } },
];
