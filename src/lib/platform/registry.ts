"use client";

/**
 * Loads every platform registration (rules, operation types, templates, events, hook points) once at startup.
 * Each module adds one line here: `import "@/modules/<module>/platform";`
 */
import "./core";
import "@/modules/origination/platform";
import "@/modules/credit-analysis/platform";
import "@/modules/offer-letters/platform";
import "@/modules/credit-admin/platform";
import "@/modules/disbursement/platform";
import "@/modules/monitoring/platform";
import "@/modules/collateral/platform";
import "@/modules/connectors/platform";
import "@/modules/portfolio/platform";
import "@/modules/executive/platform";
import "@/modules/ifrs9/platform";
import "@/modules/market-risk/platform";
import "@/modules/operational-risk/platform";
import "@/modules/enterprise-risk/platform";
import "@/modules/ai/platform";
import "@/modules/workspace/platform";
import "@/modules/admin/platform";
import "@/modules/settings/platform";
import "@/modules/operations/platform";
