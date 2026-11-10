/**
 * Deterministic demo data for the prototype (same data on every machine).
 * All names and numbers are fictional and generated — not customer data.
 */
import { Faker, en, en_NG } from "@faker-js/faker";
import { addDays, addMonths, subDays, subMonths } from "date-fns";
import { roles, type RoleId } from "../rbac/roles";
import { buildApprovalChain, settleChain } from "../workflow";
import type {
  Application,
  ApplicationStage,
  AuditEvent,
  CbnClass,
  Collateral,
  CollateralType,
  DocumentRecord,
  Facility,
  Notification,
  Obligor,
  ObligorType,
  PerfectionStatus,
  ProductType,
  Sector,
  Task,
  Tenant,
  User,
} from "./types";

export const DEMO_NOW = new Date("2026-11-10T09:00:00+01:00");

export const tenant: Tenant = {
  id: "TEN-001",
  name: "Harbourline Bank Plc (demo tenant)",
  shortName: "Harbourline Bank",
  type: "Commercial bank",
  environment: "Demo",
};

export const sectors: Sector[] = [
  { id: "SEC-AGR", name: "Agriculture", limitPct: 10 },
  { id: "SEC-MIN", name: "Mining & quarrying", limitPct: 4 },
  { id: "SEC-MFG", name: "Manufacturing", limitPct: 18 },
  { id: "SEC-OGU", name: "Oil & gas — upstream", limitPct: 12 },
  { id: "SEC-OGD", name: "Oil & gas — downstream", limitPct: 10 },
  { id: "SEC-PWR", name: "Power & energy", limitPct: 8 },
  { id: "SEC-CON", name: "Construction", limitPct: 7 },
  { id: "SEC-RES", name: "Real estate", limitPct: 6 },
  { id: "SEC-COM", name: "General commerce", limitPct: 15 },
  { id: "SEC-TRN", name: "Transportation & storage", limitPct: 6 },
  { id: "SEC-ICT", name: "Information & communication", limitPct: 8 },
  { id: "SEC-FIN", name: "Finance & insurance", limitPct: 6 },
  { id: "SEC-EDU", name: "Education", limitPct: 3 },
  { id: "SEC-HLT", name: "Health", limitPct: 3 },
  { id: "SEC-GOV", name: "Government", limitPct: 10 },
];

export const branches = ["Victoria Island", "Ikeja", "Apapa", "Lekki", "Abuja Central", "Port Harcourt", "Kano", "Ibadan", "Enugu", "Kaduna"];
const states = ["Lagos", "Lagos", "Lagos", "FCT", "Rivers", "Kano", "Oyo", "Enugu", "Kaduna", "Ogun", "Delta", "Anambra"];

const suffixBySector: Record<string, string[]> = {
  "SEC-AGR": ["Agro Processing Ltd", "Farms Ltd", "Agro-Allied Ltd", "Poultry Ltd"],
  "SEC-MIN": ["Mining Ltd", "Quarries Ltd"],
  "SEC-MFG": ["Industries Plc", "Manufacturing Ltd", "Packaging Ltd", "Foods Plc", "Plastics Ltd"],
  "SEC-OGU": ["Petroleum Ltd", "Energy Resources Ltd", "Oilfield Services Ltd"],
  "SEC-OGD": ["Oil & Gas Ltd", "Petroleum Products Ltd", "Gas Distribution Ltd"],
  "SEC-PWR": ["Power Ltd", "Solar Energy Ltd", "Utilities Ltd"],
  "SEC-CON": ["Construction Ltd", "Engineering Ltd", "Builders Ltd"],
  "SEC-RES": ["Properties Ltd", "Estates Ltd", "Homes Ltd"],
  "SEC-COM": ["Trading Ltd", "Stores Ltd", "Distribution Ltd", "Ventures"],
  "SEC-TRN": ["Logistics Ltd", "Haulage Ltd", "Shipping Ltd"],
  "SEC-ICT": ["Technologies Ltd", "Digital Ltd", "Telecoms Ltd"],
  "SEC-FIN": ["Insurance Ltd", "Capital Ltd", "Microfinance Bank"],
  "SEC-EDU": ["Schools Ltd", "Education Services Ltd"],
  "SEC-HLT": ["Hospitals Ltd", "Pharmaceuticals Ltd", "Diagnostics Ltd"],
  "SEC-GOV": ["State Ministry of Works", "State Water Board", "Local Government Council"],
};

function makeFaker() {
  const f = new Faker({ locale: [en_NG, en] });
  f.seed(360);
  return f;
}

function iso(d: Date) {
  return d.toISOString();
}

export type SeedData = {
  tenant: Tenant;
  users: User[];
  sectors: Sector[];
  obligors: Obligor[];
  facilities: Facility[];
  applications: Application[];
  collateral: Collateral[];
  documents: DocumentRecord[];
  tasks: Task[];
  notifications: Notification[];
  audit: AuditEvent[];
};

export function createSeed(): SeedData {
  const f = makeFaker();
  const pick = <T,>(arr: readonly T[]) => f.helpers.arrayElement(arr);
  const weighted = <T,>(items: Array<{ value: T; weight: number }>) => f.helpers.weightedArrayElement(items);

  // ---------------- Users: at least one per role ----------------
  const users: User[] = roles.map((role, i) => {
    const first = f.person.firstName();
    const last = f.person.lastName();
    return {
      id: `USR-${String(i + 1).padStart(3, "0")}`,
      name: `${first} ${last}`,
      email: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@harbourline.example",
      roleId: role.id,
      branch: pick(branches),
      status: "Active",
      mfa: true,
      lastLogin: iso(subDays(DEMO_NOW, f.number.int({ min: 0, max: 6 }))),
    };
  });
  // Extra front-office staff
  for (let i = 0; i < 8; i++) {
    const first = f.person.firstName();
    const last = f.person.lastName();
    users.push({
      id: `USR-${String(users.length + 1).padStart(3, "0")}`,
      name: `${first} ${last}`,
      email: `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, "") + "@harbourline.example",
      roleId: i % 2 ? "bdm" : "account-officer",
      branch: pick(branches),
      status: i === 7 ? "Pending" : "Active",
      mfa: i !== 7,
      lastLogin: i === 7 ? undefined : iso(subDays(DEMO_NOW, f.number.int({ min: 0, max: 20 }))),
    });
  }
  const userOf = (roleId: RoleId) => users.find((u) => u.roleId === roleId)!;
  const officers = users.filter((u) => u.roleId === "account-officer");

  // ---------------- Obligors ----------------
  const obligors: Obligor[] = Array.from({ length: 80 }, (_, i) => {
    const sector = weighted(sectors.map((s) => ({ value: s, weight: s.limitPct })));
    const type: ObligorType =
      sector.id === "SEC-GOV" ? "Public sector" : weighted([
        { value: "Corporate" as const, weight: 3 },
        { value: "Commercial" as const, weight: 3 },
        { value: "SME" as const, weight: 4 },
        { value: "Retail" as const, weight: 1 },
      ]);
    const name =
      type === "Retail"
        ? f.person.fullName()
        : sector.id === "SEC-GOV"
          ? `${pick(["Lagos", "Ogun", "Rivers", "Kaduna", "Enugu", "Oyo"])} ${pick(suffixBySector[sector.id]!)}`
          : `${f.person.lastName()} ${pick(suffixBySector[sector.id]!)}`;
    const scale = type === "Corporate" ? 1e10 : type === "Commercial" ? 2.5e9 : type === "Public sector" ? 8e9 : type === "SME" ? 4e8 : 3e7;
    const declared = Math.round(scale * f.number.float({ min: 0.4, max: 2.2 }));
    const cop = f.number.float({ min: 0.55, max: 1.08, fractionDigits: 2 });
    const score = () => f.number.float({ min: 2.5, max: 9.2, fractionDigits: 1 });
    const watch = f.number.int({ min: 0, max: 9 }) === 0;
    return {
      id: `OBL-${String(1001 + i)}`,
      name,
      type,
      sectorId: sector.id,
      rcNumber: type === "Retail" ? undefined : `RC${f.number.int({ min: 100000, max: 1899999 })}`,
      bvnMasked: type === "Retail" ? `222****${f.number.int({ min: 1000, max: 9999 })}` : undefined,
      relationshipManagerId: pick(officers).id,
      branch: pick(branches),
      state: pick(states),
      customerSince: iso(subMonths(DEMO_NOW, f.number.int({ min: 8, max: 180 }))),
      riskGrade: watch ? f.number.int({ min: 6, max: 9 }) : f.number.int({ min: 1, max: 6 }),
      rar: { internal: score(), industry: score(), comparative: score(), macro: f.number.float({ min: 3.5, max: 7.5, fractionDigits: 1 }) },
      rarUpdatedAt: iso(subDays(DEMO_NOW, f.number.int({ min: 1, max: 120 }))),
      declaredTurnover: declared,
      verifiedTurnover: Math.round(declared * cop),
      watchlist: watch,
    };
  });

  const products: ProductType[] = [
    "Term loan",
    "Overdraft",
    "Revolving credit",
    "Lease finance",
    "Trade finance (LC)",
    "Bank guarantee",
    "Advance payment guarantee",
    "Invoice discounting",
    "Asset finance",
  ];

  // ---------------- Collateral ----------------
  const collateral: Collateral[] = [];
  const collateralTypes: CollateralType[] = [
    "Legal mortgage",
    "Equitable mortgage",
    "Debenture",
    "Quoted shares",
    "Cash / lien on deposit",
    "Vehicle",
    "Equipment",
    "Domiciliation of proceeds",
    "Corporate guarantee",
    "Personal guarantee",
    "Insurance policy",
  ];
  const haircut: Record<CollateralType, number> = {
    "Legal mortgage": 30,
    "Equitable mortgage": 40,
    Debenture: 50,
    "Quoted shares": 40,
    "Cash / lien on deposit": 0,
    Vehicle: 40,
    Equipment: 45,
    "Domiciliation of proceeds": 60,
    "Personal guarantee": 100,
    "Corporate guarantee": 70,
    "Insurance policy": 50,
    };
  const tickers = ["DANGCEM", "MTNN", "ZENITHBANK", "GTCO", "NESTLE", "SEPLAT", "BUACEMENT", "AIRTELAFRI", "OKOMUOIL", "PRESCO"];
  const newCollateral = (obligor: Obligor, value: number): Collateral => {
    const type = pick(collateralTypes);
    const perfection: PerfectionStatus = weighted([
      { value: "Perfected" as const, weight: 7 },
      { value: "Registration" as const, weight: 1 },
      { value: "Documentation" as const, weight: 1 },
      { value: "Search in progress" as const, weight: 1 },
      { value: "Defective" as const, weight: 0.4 },
    ]);
    const c: Collateral = {
      id: `COL-${String(5001 + collateral.length)}`,
      obligorId: obligor.id,
      type,
      description:
        type === "Quoted shares"
          ? "Lien over quoted equities held at CSCS"
          : type.includes("mortgage")
            ? `${pick(["Duplex", "Warehouse", "Office complex", "Plot of land", "Factory premises"])}, ${f.location.street()}, ${obligor.state}`
            : type === "Vehicle"
              ? `${pick(["Toyota Hilux", "Mack trucks (fleet)", "Toyota Coaster bus", "MAN tanker"])}`
              : type === "Equipment"
                ? `${pick(["Production line", "Generating sets", "Earth-moving equipment", "Cold-room equipment"])}`
                : type,
      marketValue: Math.round(value),
      forcedSaleValue: Math.round(value * 0.7),
      haircutPct: haircut[type],
      valuedAt: iso(subMonths(DEMO_NOW, f.number.int({ min: 1, max: 30 }))),
      valuer: pick(["Ubosi Eleh & Co", "Knight Frank Nigeria", "Jide Taiwo & Co", "Diya Fatimilehin & Co", "Internal valuation"]),
      nextRevaluation: iso(addMonths(DEMO_NOW, f.number.int({ min: -3, max: 24 }))),
      perfection,
      insuranceExpiry: ["Legal mortgage", "Vehicle", "Equipment"].includes(type) ? iso(addDays(DEMO_NOW, f.number.int({ min: -30, max: 330 }))) : undefined,
      location: obligor.state,
      ticker: type === "Quoted shares" ? pick(tickers) : undefined,
      units: type === "Quoted shares" ? f.number.int({ min: 100_000, max: 25_000_000 }) : undefined,
      facilityIds: [],
    };
    collateral.push(c);
    return c;
  };

  // ---------------- Facilities ----------------
  const facilities: Facility[] = [];
  for (const o of obligors) {
    const count = o.type === "Corporate" ? f.number.int({ min: 2, max: 4 }) : f.number.int({ min: 1, max: 2 });
    for (let k = 0; k < count; k++) {
      const product = o.type === "Retail" ? pick(["Term loan", "Overdraft", "Asset finance"] as ProductType[]) : pick(products);
      const amount = Math.round((o.declaredTurnover * f.number.float({ min: 0.05, max: 0.35 })) / 1e5) * 1e5;
      const tenor = product === "Overdraft" || product === "Revolving credit" ? 12 : pick([12, 18, 24, 36, 48, 60]);
      const start = subMonths(DEMO_NOW, f.number.int({ min: 1, max: Math.max(2, tenor - 1) }));
      const dpd = o.watchlist
        ? pick([15, 32, 45, 75, 95, 130, 200, 380])
        : weighted([
            { value: 0, weight: 18 },
            { value: f.number.int({ min: 1, max: 29 }), weight: 2 },
            { value: f.number.int({ min: 30, max: 89 }), weight: 0.7 },
          ]);
      const cbnClass: CbnClass = dpd >= 360 ? "Lost" : dpd >= 180 ? "Doubtful" : dpd >= 90 ? "Substandard" : dpd >= 30 || o.watchlist ? "Watchlist" : "Performing";
      const stage = dpd >= 90 ? 3 : dpd >= 30 || o.watchlist ? 2 : 1;
      const drawn = product.includes("guarantee") ? 0 : f.number.float({ min: 0.35, max: 1 });
      const fac: Facility = {
        id: `FAC-${String(20001 + facilities.length)}`,
        obligorId: o.id,
        product,
        approvedAmount: amount,
        outstanding: Math.round(amount * drawn),
        currency: product === "Trade finance (LC)" && f.number.int({ min: 0, max: 2 }) === 0 ? "USD" : "NGN",
        ratePct: f.number.float({ min: 18, max: 32, fractionDigits: 1 }),
        tenorMonths: tenor,
        startDate: iso(start),
        maturityDate: iso(addMonths(start, tenor)),
        dpd,
        cbnClass,
        stage: stage as 1 | 2 | 3,
        collateralIds: [],
        status: "Active",
        branch: o.branch,
      };
      const nCol = f.number.int({ min: 1, max: 2 });
      for (let c = 0; c < nCol; c++) {
        const col = newCollateral(o, amount * f.number.float({ min: 0.6, max: 1.6 }));
        col.facilityIds.push(fac.id);
        fac.collateralIds.push(col.id);
      }
      facilities.push(fac);
    }
  }

  // ---------------- Applications (pipeline) ----------------
  const stages: ApplicationStage[] = ["Draft", "Documents", "Analysis", "Recommendation", "Approval", "Approval", "Approval", "Offer", "Conditions", "Disbursement", "Booked", "Declined"];
  const purposes = [
    "Working capital to finance raw material imports",
    "Purchase of new production line",
    "Bridge finance for confirmed government contract",
    "Expansion of warehouse capacity",
    "Refinancing of existing obligations",
    "Fleet expansion (12 trucks)",
    "Import of finished goods under LC",
    "Construction of solar mini-grid",
    "Advance payment guarantee for EPC contract",
    "Invoice discounting for confirmed receivables",
  ];
  const documents: DocumentRecord[] = [];
  const applications: Application[] = Array.from({ length: 36 }, (_, i) => {
    const o = obligors[(i * 7) % obligors.length]!;
    const stage = stages[i % stages.length]!;
    const product = pick(products);
    const amount = Math.round((o.declaredTurnover * f.number.float({ min: 0.08, max: 0.5 })) / 1e6) * 1e6;
    const flow = amount <= 50_000_000 && o.type !== "Corporate" ? "Fast-Track" : "Standard";
    const created = subDays(DEMO_NOW, f.number.int({ min: 1, max: 40 }));
    const ao = users.find((u) => u.id === o.relationshipManagerId)!;
    const chain = buildApprovalChain(amount, users);
    const app: Application = {
      id: `APP-${String(2026001 + i)}`,
      obligorId: o.id,
      product,
      amount,
      tenorMonths: product === "Overdraft" ? 12 : pick([12, 24, 36, 48]),
      purpose: pick(purposes),
      flow,
      requestType: pick(["New", "New", "Renewal", "Enhancement", "Restructure"] as const),
      stage,
      createdById: ao.id,
      createdAt: iso(created),
      updatedAt: iso(addDays(created, f.number.int({ min: 0, max: 5 }))),
      slaDueAt: iso(addDays(created, flow === "Fast-Track" ? 3 : 10)),
      approvals: settleChain(chain, stage, i, users, f),
      documentIds: [],
      collateralIds: collateral.filter((c) => c.obligorId === o.id).slice(0, 2).map((c) => c.id),
      copRatio: stage === "Draft" ? undefined : Number((o.verifiedTurnover / o.declaredTurnover).toFixed(2)),
      recommendation: ["Draft", "Documents", "Analysis"].includes(stage) ? undefined : stage === "Declined" ? "Decline" : pick(["Approve", "Approve with conditions"] as const),
      covenants: ["Debt service cover ratio ≥ 1.25x", "Domiciliation of contract proceeds", "Quarterly management accounts within 45 days"].slice(0, f.number.int({ min: 1, max: 3 })),
      bureauChecked: stage !== "Draft",
      crmsChecked: !["Draft", "Documents"].includes(stage),
      limitGate: stage === "Draft" ? "Not checked" : i === 9 ? "Breach — sector" : "Within limit",
    };
    const kinds: DocumentRecord["kind"][] = ["Audited financials", "Management accounts", "Bank statement", "KYC", "Board resolution"];
    if (stage !== "Draft") {
      for (const kind of kinds) {
        const d: DocumentRecord = {
          id: `DOC-${String(70001 + documents.length)}`,
          ownerType: "application",
          ownerId: app.id,
          name: `${kind} — ${o.name}.pdf`,
          kind,
          sizeKb: f.number.int({ min: 180, max: 6200 }),
          version: kind === "Audited financials" && i % 4 === 0 ? 2 : 1,
          uploadedById: ao.id,
          uploadedAt: iso(addDays(created, 1)),
          status: stage === "Documents" && kind === "Audited financials" ? "Processing OCR" : kind === "Audited financials" || kind === "Bank statement" ? "Verified" : "Extracted",
        };
        documents.push(d);
        app.documentIds.push(d.id);
      }
    }
    return app;
  });

  // Facilities created from booked applications
  for (const app of applications.filter((a) => a.stage === "Disbursement" || a.stage === "Booked")) {
    const o = obligors.find((x) => x.id === app.obligorId)!;
    facilities.push({
      id: `FAC-${String(20001 + facilities.length)}`,
      obligorId: o.id,
      applicationId: app.id,
      product: app.product,
      approvedAmount: app.amount,
      outstanding: app.stage === "Booked" ? app.amount : 0,
      currency: "NGN",
      ratePct: 24.5,
      tenorMonths: app.tenorMonths,
      startDate: app.updatedAt,
      maturityDate: iso(addMonths(new Date(app.updatedAt), app.tenorMonths)),
      dpd: 0,
      cbnClass: "Performing",
      stage: 1,
      collateralIds: app.collateralIds,
      status: app.stage === "Booked" ? "Active" : "Pending disbursement",
      branch: o.branch,
    });
  }

  // ---------------- Tasks, notifications, audit ----------------
  const tasks: Task[] = [];
  for (const app of applications.filter((a) => a.stage === "Approval")) {
    const next = app.approvals.find((s) => s.decision === "pending");
    if (next) {
      tasks.push({
        id: `TSK-${tasks.length + 1}`,
        title: `Approve ${app.id} — ${obligors.find((o) => o.id === app.obligorId)!.name}`,
        module: "Loan origination",
        href: `/origination/application?id=${app.id}`,
        assigneeRoleId: next.roleId,
        dueAt: app.slaDueAt,
        priority: app.amount > 1e9 ? "High" : "Medium",
        status: "Open",
      });
    }
  }
  const taskTemplates: Array<[RoleId, string, string, string]> = [
    ["credit-analyst", "Run 360 RAR for", "Credit analysis", "/credit-analysis"],
    ["credit-admin-officer", "Confirm conditions precedent for", "Credit administration", "/credit-admin"],
    ["loan-review-officer", "Review past-due exposure", "Loan review & monitoring", "/monitoring"],
    ["collateral-officer", "Revalue collateral for", "Collateral & legal", "/collateral"],
    ["legal-officer", "Legal search and perfection for", "Collateral & legal", "/collateral/legal"],
    ["disbursement-maker", "Prepare disbursement for", "Disbursement", "/disbursement"],
    ["disbursement-checker", "Authorise disbursement for", "Disbursement", "/disbursement"],
    ["portfolio-mis-officer", "Reconcile month-end portfolio to CBA", "Portfolio & MIS", "/portfolio"],
    ["account-officer", "Upload outstanding KYC for", "Loan origination", "/origination"],
    ["bdm", "Recommend or decline", "Loan origination", "/origination"],
  ];
  taskTemplates.forEach(([roleId, verb, module, href], k) => {
    for (let n = 0; n < 3; n++) {
      const o = obligors[(k * 5 + n * 11) % obligors.length]!;
      tasks.push({
        id: `TSK-${tasks.length + 1}`,
        title: verb.endsWith("CBA") ? verb : `${verb} ${o.name}`,
        module,
        href,
        assigneeRoleId: roleId,
        dueAt: iso(addDays(DEMO_NOW, n - 1)),
        priority: n === 0 ? "High" : "Medium",
        status: "Open",
      });
    }
  });

  const notifications: Notification[] = [
    { id: "NTF-1", title: "Sector limit near breach", body: "General commerce is at 96% of its sectoral limit.", tone: "warning", createdAt: iso(subDays(DEMO_NOW, 0)), read: false, href: "/portfolio/limits", roleIds: ["cro", "head-of-risk", "portfolio-mis-officer", "credit-analyst"] },
    { id: "NTF-2", title: "AI flag: inflow shortfall", body: "Three obligors show account inflows below 60% of declared turnover.", tone: "danger", createdAt: iso(subDays(DEMO_NOW, 1)), read: false, href: "/monitoring/covenants", roleIds: ["loan-review-officer", "cro", "head-of-risk", "credit-analyst"] },
    { id: "NTF-3", title: "Bureau connector delayed", body: "Credit bureau responses are taking longer than usual. Retrying automatically.", tone: "info", createdAt: iso(subDays(DEMO_NOW, 1)), read: true, href: "/connectors", roleIds: [] },
    { id: "NTF-4", title: "Approval requested", body: "A facility above your limit has been escalated to you.", tone: "info", createdAt: iso(subDays(DEMO_NOW, 0)), read: false, href: "/inbox", roleIds: ["cco", "directorate-head", "cro", "md", "group-head"] },
    { id: "NTF-5", title: "Insurance expiring", body: "7 collateral insurance policies expire in the next 30 days.", tone: "warning", createdAt: iso(subDays(DEMO_NOW, 2)), read: false, href: "/collateral", roleIds: ["collateral-officer", "credit-admin-officer", "legal-officer"] },
    { id: "NTF-6", title: "Month-end MIS ready", body: "October portfolio pack has been generated and reconciled to the CBA.", tone: "success", createdAt: iso(subDays(DEMO_NOW, 3)), read: true, href: "/portfolio/reports", roleIds: [] },
  ];

  const audit: AuditEvent[] = [];
  const actions = ["Signed in", "Viewed record", "Updated field", "Uploaded document", "Approved", "Recommended", "Generated report", "Changed parameter"];
  for (let i = 0; i < 60; i++) {
    const u = pick(users);
    const action = pick(actions);
    audit.push({
      id: `AUD-${String(900001 + i)}`,
      at: iso(subDays(DEMO_NOW, i * 0.3)),
      actorId: u.id,
      actorName: u.name,
      roleId: u.roleId,
      action,
      entityType: action === "Signed in" ? "Session" : pick(["Application", "Facility", "Collateral", "Parameter"]),
      entityId: action === "Signed in" ? "-" : pick(applications).id,
      before: action === "Updated field" || action === "Changed parameter" ? "18.0%" : undefined,
      after: action === "Updated field" || action === "Changed parameter" ? "20.0%" : undefined,
      ip: `10.20.${f.number.int({ min: 1, max: 40 })}.${f.number.int({ min: 2, max: 250 })}`,
      device: pick(["Windows 11 · Edge", "Windows 11 · Chrome", "macOS · Safari", "Android · Chrome"]),
    });
  }

  void userOf;
  return { tenant, users, sectors, obligors, facilities, applications, collateral, documents, tasks, notifications, audit };
}
