/**
 * Shared domain types — the "Risk Data Spine" (PRD §5): obligors, facilities, applications, collateral.
 * Prototype: values are generated demo data. Shapes are designed to map onto the future backend API.
 */
import type { RoleId } from "../rbac/roles";

export type ID = string;
export type ISODate = string;

export type Tenant = {
  id: ID;
  name: string;
  shortName: string;
  type: "Commercial bank" | "Microfinance bank" | "Merchant bank";
};

export type User = {
  id: ID;
  name: string;
  email: string;
  roleId: RoleId;
  branch: string;
  status: "Active" | "Suspended" | "Pending";
  mfa: boolean;
  lastLogin?: ISODate;
  /** How the last session was started (backend directory): "password" or "microsoft". */
  signInMethod?: string;
  /** Second sign-in step (backend directory, ADR-0017): "email" or "authenticator". */
  mfaMethod?: string;
};

/** CBN-style sector taxonomy (tenant-configurable per PRD §6.6.1). */
export type Sector = {
  id: ID;
  name: string;
  /** Sectoral limit as % of total loan book (illustrative). */
  limitPct: number;
};

export type ObligorType = "Corporate" | "Commercial" | "SME" | "Retail" | "Public sector";

/** CBN prudential classification. */
export type CbnClass = "Performing" | "Watchlist" | "Substandard" | "Doubtful" | "Lost";
export type Ifrs9Stage = 1 | 2 | 3;

export type RarScores = {
  /** North — Internal Risk Assessment (1–10). */
  internal: number;
  /** South — Operating Industry Assessment (1–10). */
  industry: number;
  /** East — Comparative Assessment (1–10). */
  comparative: number;
  /** West — Macro-Economic Assessment (1–10). */
  macro: number;
};

export type Posture = "Aggressive" | "Competitive" | "Conservative" | "Defensive";

export type Obligor = {
  id: ID;
  name: string;
  type: ObligorType;
  sectorId: ID;
  rcNumber?: string;
  bvnMasked?: string;
  relationshipManagerId: ID;
  branch: string;
  state: string;
  customerSince: ISODate;
  /** Internal risk rating grade 1 (best) – 10 (worst). */
  riskGrade: number;
  rar: RarScores;
  rarUpdatedAt: ISODate;
  /** Declared annual turnover (NGN). */
  declaredTurnover: number;
  /** Verified bank turnover (NGN) — CBA + other-bank statements. */
  verifiedTurnover: number;
  watchlist: boolean;
};

export type ProductType =
  | "Term loan"
  | "Overdraft"
  | "Revolving credit"
  | "Lease finance"
  | "Trade finance (LC)"
  | "Bank guarantee"
  | "Advance payment guarantee"
  | "Invoice discounting"
  | "Mortgage"
  | "Asset finance";

export type Facility = {
  id: ID;
  obligorId: ID;
  applicationId?: ID;
  product: ProductType;
  approvedAmount: number;
  outstanding: number;
  /** Booking currency. Prototype: amounts on USD facilities are stored as NGN equivalents (no FX conversion applied). */
  currency: "NGN" | "USD";
  ratePct: number;
  tenorMonths: number;
  startDate: ISODate;
  maturityDate: ISODate;
  /** Days past due. */
  dpd: number;
  cbnClass: CbnClass;
  stage: Ifrs9Stage;
  collateralIds: ID[];
  status: "Active" | "Pending disbursement" | "Closed" | "Restructured" | "Written off";
  branch: string;
};

export type ApplicationStage =
  | "Draft"
  | "Documents"
  | "Analysis"
  | "Recommendation"
  | "Approval"
  | "Offer"
  | "Conditions"
  | "Disbursement"
  | "Booked"
  | "Declined"
  | "Withdrawn";

export type ApprovalDecision = "pending" | "approved" | "declined" | "recommended" | "dissent" | "adjudicated" | "escalated" | "returned";

export type ApprovalStep = {
  id: ID;
  tier: number;
  roleId: RoleId;
  assigneeId?: ID;
  decision: ApprovalDecision;
  comment?: string;
  decidedAt?: ISODate;
  /** Co-signer pair id — steps with the same pair id sign together (PRD §6.1.2). */
  pair?: string;
  /** Adjudicator step created when co-signers dissent. */
  adjudicates?: string;
};

export type Application = {
  id: ID;
  obligorId: ID;
  product: ProductType;
  amount: number;
  tenorMonths: number;
  purpose: string;
  /** Standard credit or Fast-Track chart-flow (PRD §6.1.3). */
  flow: "Standard" | "Fast-Track";
  requestType: "New" | "Renewal" | "Enhancement" | "Restructure" | "Waiver";
  stage: ApplicationStage;
  createdById: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  slaDueAt: ISODate;
  approvals: ApprovalStep[];
  documentIds: ID[];
  collateralIds: ID[];
  /** COP ratio = verified / declared turnover (PRD §6.1.4). */
  copRatio?: number;
  recommendation?: "Approve" | "Approve with conditions" | "Decline" | "Refer";
  covenants: string[];
  bureauChecked: boolean;
  crmsChecked: boolean;
  limitGate: "Within limit" | "Breach — sector" | "Breach — single obligor" | "Not checked";
};

export type CollateralType =
  | "Legal mortgage"
  | "Equitable mortgage"
  | "Debenture"
  | "Quoted shares"
  | "Cash / lien on deposit"
  | "Vehicle"
  | "Equipment"
  | "Domiciliation of proceeds"
  | "Personal guarantee"
  | "Corporate guarantee"
  | "Insurance policy";

export type PerfectionStatus = "Not started" | "Search in progress" | "Documentation" | "Registration" | "Perfected" | "Defective";

export type Collateral = {
  id: ID;
  obligorId: ID;
  type: CollateralType;
  description: string;
  marketValue: number;
  forcedSaleValue: number;
  haircutPct: number;
  valuedAt: ISODate;
  valuer: string;
  nextRevaluation: ISODate;
  perfection: PerfectionStatus;
  insuranceExpiry?: ISODate;
  location?: string;
  /** For quoted shares (SEC/CSCS connector, PRD §5.7). */
  ticker?: string;
  units?: number;
  facilityIds: ID[];
};

export type DocumentStatus = "Uploaded" | "Processing OCR" | "Extracted" | "Verified" | "Rejected";

export type DocumentRecord = {
  id: ID;
  ownerType: "application" | "obligor" | "facility" | "collateral";
  ownerId: ID;
  name: string;
  kind: "Audited financials" | "Management accounts" | "Bank statement" | "KYC" | "Board resolution" | "Title document" | "Valuation report" | "Offer letter" | "Other";
  sizeKb: number;
  version: number;
  uploadedById: ID;
  uploadedAt: ISODate;
  status: DocumentStatus;
};

export type Task = {
  id: ID;
  title: string;
  module: string;
  href: string;
  assigneeRoleId: RoleId;
  dueAt: ISODate;
  priority: "High" | "Medium" | "Low";
  status: "Open" | "Done";
};

export type Notification = {
  id: ID;
  title: string;
  body: string;
  tone: "info" | "success" | "warning" | "danger";
  createdAt: ISODate;
  read: boolean;
  href?: string;
  /** Role broadcast: restrict to roles; empty = everyone (ignored when `userIds` is set). */
  roleIds: RoleId[];
  /** Personal notification: only these users see it (OPS-FR-18). */
  userIds?: ID[];
  /** Users who have read it (per-user read state). `read` is the legacy flag for seed rows. */
  readBy?: ID[];
};

export type AuditEvent = {
  id: ID;
  at: ISODate;
  actorId: ID;
  actorName: string;
  roleId: RoleId;
  action: string;
  entityType: string;
  entityId: ID;
  before?: string;
  after?: string;
  ip: string;
  device: string;
};
