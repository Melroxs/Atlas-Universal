// ---------------------------------------------------------------------------
// Everest — Universal Business Brain
//
// Structured, industry-agnostic knowledge of how organizations work. This is
// the foundational layer every tenant gets — NOT an industry pack. Business
// model, industry, operating model and company size are independent
// dimensions; nothing here assumes a single vertical.
// ---------------------------------------------------------------------------

export interface Concept {
  key: string;
  name: string;
  summary: string;
  content: Record<string, unknown>;
  confidence: number;
}

// --- 5. Business types -------------------------------------------------------

export const BUSINESS_TYPES: Concept[] = [
  { key: "b2b", name: "B2B", summary: "Sells products or services to other businesses.", content: { buyers: "businesses", salesCycle: "longer, relationship-driven", typicalPricing: "contract / volume" }, confidence: 0.95 },
  { key: "b2c", name: "B2C", summary: "Sells directly to individual consumers.", content: { buyers: "consumers", salesCycle: "short, high-volume", typicalPricing: "retail" }, confidence: 0.95 },
  { key: "b2b2c", name: "B2B2C", summary: "Sells through another business to end consumers.", content: { buyers: "business then consumer", salesCycle: "two-stage", typicalPricing: "wholesale + channel" }, confidence: 0.9 },
  { key: "d2c", name: "D2C", summary: "Direct-to-consumer, bypassing intermediaries.", content: { buyers: "consumers direct", salesCycle: "digital-first", typicalPricing: "retail minus margin" }, confidence: 0.9 },
  { key: "marketplace", name: "Marketplace", summary: "Connects buyers and sellers and takes a fee.", content: { revenue: "commission / listing / ads", keyMetric: "GMV, take rate", risk: "supply and demand both sides" }, confidence: 0.9 },
  { key: "subscription", name: "Subscription", summary: "Recurring fee for continued access or service.", content: { revenue: "recurring", keyMetric: "MRR/ARR, churn, retention", cashFlow: "predictable, deferred" }, confidence: 0.95 },
  { key: "usage-based", name: "Usage-based", summary: "Charges by measured consumption.", content: { revenue: "variable by use", keyMetric: "units consumed, price per unit", risk: "demand volatility" }, confidence: 0.9 },
  { key: "transaction-based", name: "Transaction-based", summary: "Earns per completed transaction.", content: { revenue: "per transaction", keyMetric: "volume × fee", risk: "volume concentration" }, confidence: 0.9 },
  { key: "commission-based", name: "Commission-based", summary: "Earns a share of deals or sales it arranges.", content: { revenue: "percentage of sale", keyMetric: "closed volume, commission rate", risk: "pipeline dependence" }, confidence: 0.9 },
  { key: "project-based", name: "Project-based", summary: "Sells discrete, scoped projects.", content: { revenue: "per project", keyMetric: "backlog, margin per project", risk: "estimating accuracy" }, confidence: 0.95 },
  { key: "recurring-services", name: "Recurring services", summary: "Ongoing service contracts on a schedule.", content: { revenue: "recurring service fees", keyMetric: "contract renewals", risk: "service quality" }, confidence: 0.9 },
  { key: "professional-services", name: "Professional services", summary: "Expert advice or skilled work billed by time or outcome.", content: { revenue: "hourly / fixed fee", keyMetric: "utilization, billable rate", risk: "capacity vs demand" }, confidence: 0.9 },
  { key: "retail", name: "Retail", summary: "Sells finished goods directly to end buyers.", content: { revenue: "margin on goods", keyMetric: "sell-through, margin", risk: "inventory" }, confidence: 0.9 },
  { key: "wholesale", name: "Wholesale", summary: "Sells goods in volume to resellers.", content: { revenue: "volume margin", keyMetric: "order size, turnover", risk: "margin compression" }, confidence: 0.9 },
  { key: "manufacturing", name: "Manufacturing", summary: "Converts inputs into finished goods.", content: { revenue: "goods sold", keyMetric: "OEE, capacity utilization", risk: "fixed costs, supply chain" }, confidence: 0.9 },
  { key: "distribution", name: "Distribution", summary: "Moves and warehouses goods between producers and sellers.", content: { revenue: "logistics margin", keyMetric: "on-time, cost per unit", risk: "fuel/labor cost" }, confidence: 0.9 },
  { key: "logistics", name: "Logistics", summary: "Transports and coordinates physical goods.", content: { revenue: "freight / fulfillment", keyMetric: "on-time delivery, utilization", risk: "capacity and routing" }, confidence: 0.9 },
  { key: "franchise", name: "Franchise", summary: "Licenses a brand and operating system to operators.", content: { revenue: "fees + royalties", keyMetric: "unit economics, royalty rate", risk: "brand consistency" }, confidence: 0.9 },
  { key: "licensing", name: "Licensing", summary: "Sells rights to use intellectual property.", content: { revenue: "royalties / fees", keyMetric: "license volume, renewal", risk: "IP protection" }, confidence: 0.9 },
  { key: "membership", name: "Membership", summary: "Recurring access to benefits, community or services.", content: { revenue: "member fees", keyMetric: "membership retention", risk: "benefit cost" }, confidence: 0.9 },
  { key: "nonprofit", name: "Nonprofit", summary: "Mission-driven; surplus reinvested, not distributed.", content: { revenue: "grants, donations, earned", keyMetric: "mission outcomes, funding", risk: "funding dependence" }, confidence: 0.9 },
  { key: "hybrid", name: "Hybrid", summary: "Combines multiple models (e.g. subscription + services).", content: { revenue: "mixed", keyMetric: "model mix and margins", risk: "complexity" }, confidence: 0.9 },
];

export function findBusinessType(key: string): Concept | undefined {
  return BUSINESS_TYPES.find((b) => b.key === key);
}

// --- 7. Universal financial knowledge ----------------------------------------

export const FINANCIAL_KNOWLEDGE = {
  /** Terms grouped by financial statement family. */
  revenue: [
    { term: "Sales", meaning: "Top-line income from selling goods/services.", alias: ["bookings", "billings", "recognized revenue", "collections"], caution: "See semantic note — 'sales' is ambiguous." },
    { term: "Gross revenue", meaning: "Total revenue before any deductions." },
    { term: "Net revenue", meaning: "Revenue after returns, allowances and discounts." },
    { term: "Turnover", meaning: "Revenue synonym in some jurisdictions; can also mean asset turnover." },
    { term: "Bookings", meaning: "Committed future revenue (orders/contracts signed).", caution: "Not yet earned." },
    { term: "Billings", meaning: "Amounts invoiced in a period.", caution: "Not yet collected." },
    { term: "Recognized revenue", meaning: "Revenue earned per accounting rules, may differ from billed." },
    { term: "Deferred revenue", meaning: "Cash collected for work not yet performed (liability)." },
    { term: "Recurring revenue", meaning: "Revenue expected to repeat (subscriptions, contracts)." },
    { term: "Accounts receivable", meaning: "Amounts customers owe for delivered work (asset)." },
    { term: "Collections", meaning: "Cash actually received against receivables." },
  ],
  expenses: [
    { term: "COGS", meaning: "Direct cost of delivering the product/service (materials, direct labor)." },
    { term: "Cost of sales", meaning: "COGS synonym." },
    { term: "Payroll", meaning: "Wages, salaries, taxes and benefits." },
    { term: "Rent", meaning: "Facility occupancy cost." },
    { term: "Utilities", meaning: "Energy, water, connectivity." },
    { term: "Software", meaning: "SaaS and software subscriptions." },
    { term: "Marketing", meaning: "Demand generation and brand spend." },
    { term: "Insurance", meaning: "Liability, property, workers' comp premiums." },
    { term: "Professional services", meaning: "Legal, accounting, consulting fees." },
    { term: "Depreciation", meaning: "Non-cash allocation of fixed-asset cost over useful life." },
    { term: "Interest", meaning: "Cost of debt." },
    { term: "Taxes", meaning: "Income and other taxes (excluding sales tax collected for others)." },
  ],
  profitability: [
    { term: "Gross profit", meaning: "Revenue − COGS.", formula: "Revenue − COGS" },
    { term: "Gross margin", meaning: "Gross profit ÷ revenue.", formula: "Gross profit / Revenue" },
    { term: "Operating profit", meaning: "Gross profit − operating expenses (EBIT)." },
    { term: "Operating margin", meaning: "Operating profit ÷ revenue." },
    { term: "EBITDA", meaning: "Earnings before interest, taxes, depreciation and amortization — a cash-flow proxy." },
    { term: "Net income", meaning: "Bottom line after all expenses, interest and taxes." },
    { term: "Net margin", meaning: "Net income ÷ revenue." },
    { term: "Contribution margin", meaning: "Revenue − variable costs; what covers fixed costs." },
  ],
  balanceSheet: [
    { term: "Assets", meaning: "What the business owns or is owed." },
    { term: "Liabilities", meaning: "What the business owes." },
    { term: "Equity", meaning: "Residual ownership value (assets − liabilities)." },
    { term: "Cash", meaning: "Cash and equivalents on hand." },
    { term: "Accounts receivable", meaning: "Owed by customers for delivered work." },
    { term: "Accounts payable", meaning: "Owed to suppliers/vendors." },
    { term: "Inventory", meaning: "Goods held for sale or use." },
    { term: "Fixed assets", meaning: "Long-lived tangible assets (equipment, vehicles, property)." },
    { term: "Debt", meaning: "Borrowed funds owed (liability)." },
    { term: "Retained earnings", meaning: "Cumulative profits kept in the business." },
    { term: "Working capital", meaning: "Current assets − current liabilities." },
  ],
  /** The P&L waterfall — how revenue flows to net income. */
  incomeStatementFlow: [
    { stage: "Revenue", description: "Earned top-line income.", sign: "+" },
    { stage: "COGS / Cost of sales", description: "Direct costs of delivering.", sign: "−" },
    { stage: "Gross profit", description: "What remains before overhead.", sign: "=" },
    { stage: "Operating expenses", description: "Payroll, rent, marketing, software, insurance…", sign: "−" },
    { stage: "Operating profit", description: "Profit from core operations (EBIT).", sign: "=" },
    { stage: "Interest & taxes", description: "Financing and tax obligations.", sign: "−" },
    { stage: "Net income", description: "Bottom-line profit.", sign: "=" },
  ],
  /** The accounting identity — universal, not company-specific. */
  accountingIdentity: {
    statement: "Assets = Liabilities + Equity",
    meaning: "Everything the business owns is funded either by creditors (liabilities) or owners (equity). Always balances.",
    scope: "A universal accounting relationship — never present it as a company-specific fact.",
  },
};

// --- 8. Accounting semantic intelligence ------------------------------------

/** Ambiguous business language — Atlas never treats these as equivalent. */
export const AMBIGUOUS_TERMS: Record<string, { term: string; meanings: string[]; guidance: string }> = {
  sales: {
    term: "Sales",
    meanings: ["Bookings (committed)", "Invoiced / billed amount", "Recognized revenue (earned)", "Collected cash"],
    guidance:
      "These are different numbers on different timings. When live connected data lets Atlas distinguish them, it explains which one it means; otherwise it asks.",
  },
  revenue: {
    term: "Revenue",
    meanings: ["Gross revenue", "Net revenue", "Recognized vs deferred"],
    guidance: "Label the timing basis (earned, billed, or collected) before comparing periods.",
  },
  profit: {
    term: "Profit",
    meanings: ["Gross profit", "Operating profit", "Net income"],
    guidance: "Always specify which level of the P&L a profit figure refers to.",
  },
};

/** Structured disambiguation answer for a term. */
export function disambiguateTerm(term: string) {
  const t = (term ?? "").trim().toLowerCase();
  const found = AMBIGUOUS_TERMS[t];
  return found
    ? { term: found.term, meanings: found.meanings, guidance: found.guidance }
    : null;
}

// --- 9. Organizational structures & roles ------------------------------------

export const ORG_STRUCTURES: Concept[] = [
  { key: "sole_proprietorship", name: "Sole proprietorship", summary: "One owner; no separate legal entity; personal liability.", content: { liability: "personal", tax: "pass-through", formality: "low" }, confidence: 0.95 },
  { key: "partnership", name: "Partnership", summary: "Two or more owners sharing profits and liability.", content: { liability: "shared (GP) or limited (LP/LLP)", tax: "pass-through", formality: "agreement" }, confidence: 0.95 },
  { key: "llc", name: "LLC", summary: "Limited liability company — flexible, pass-through by default.", content: { liability: "limited", tax: "pass-through or corporate election", formality: "operating agreement" }, confidence: 0.95 },
  { key: "corporation", name: "Corporation", summary: "Separate legal entity owned by shareholders.", content: { liability: "limited", tax: "corporate income tax", formality: "high (bylaws, minutes, filings)" }, confidence: 0.95 },
  { key: "s_corporation", name: "S corporation", summary: "US corporation electing pass-through taxation (≤100 shareholders).", content: { liability: "limited", tax: "pass-through", constraint: "US-specific, ownership limits" }, confidence: 0.9 },
  { key: "c_corporation", name: "C corporation", summary: "Standard US corporation taxed at corporate level.", content: { liability: "limited", tax: "corporate + dividend", constraint: "US-specific" }, confidence: 0.9 },
  { key: "cooperative", name: "Cooperative", summary: "Owned and governed by its members/users.", content: { liability: "limited", governance: "member-controlled", profit: "distributed to members" }, confidence: 0.9 },
  { key: "nonprofit", name: "Nonprofit", summary: "Mission-driven; no owners; surplus reinvested.", content: { liability: "limited", tax: "often exempt", governance: "board of directors" }, confidence: 0.9 },
  { key: "franchise", name: "Franchise", summary: "Operates under a franchisor's brand and system.", content: { owner: "franchisee", fees: "royalties to franchisor", governance: "franchise agreement" }, confidence: 0.9 },
  { key: "subsidiary", name: "Subsidiary", summary: "A company controlled by a parent.", content: { control: "parent holds >50%", liability: "usually separate", reporting: "consolidated" }, confidence: 0.9 },
  { key: "parent_company", name: "Parent company", summary: "Owns and controls one or more subsidiaries.", content: { role: "holding + governance", reporting: "consolidates" }, confidence: 0.9 },
  { key: "holding_company", name: "Holding company", summary: "Exists to own assets/companies, not to operate.", content: { role: "ownership vehicle", operations: "minimal or none" }, confidence: 0.9 },
  { key: "joint_venture", name: "Joint venture", summary: "Two+ parties combine resources for a specific undertaking.", content: { structure: "entity or contractual", control: "shared", duration: "often project-scoped" }, confidence: 0.9 },
];

export const ORG_ROLES: Concept[] = [
  { key: "owner", name: "Owner", summary: "Has ultimate economic and control interest.", content: { scope: "entire business" }, confidence: 0.95 },
  { key: "shareholder", name: "Shareholder", summary: "Owns equity in a corporation.", content: { rights: "dividends, voting (by class)" }, confidence: 0.95 },
  { key: "director", name: "Director", summary: "Sits on the board; sets direction and oversight.", content: { duty: "fiduciary, governance" }, confidence: 0.95 },
  { key: "officer", name: "Officer", summary: "Senior management appointed by the board (CEO, CFO…).", content: { duty: "day-to-day authority" }, confidence: 0.95 },
  { key: "executive", name: "Executive", summary: "C-level or senior leadership.", content: { scope: "function or company" }, confidence: 0.9 },
  { key: "manager", name: "Manager", summary: "Leads a team, function or department.", content: { scope: "team/unit" }, confidence: 0.95 },
  { key: "employee", name: "Employee", summary: "Works for the organization under an employment relationship.", content: { relationship: "W-2 / employment contract", rights: "employment law protections" }, confidence: 0.95 },
  { key: "contractor", name: "Contractor", summary: "Delivers work under a services agreement, not employment.", content: { relationship: "1099 / independent", rights: "limited employment protections" }, confidence: 0.9 },
  { key: "vendor", name: "Vendor", summary: "External supplier of goods or services.", content: { relationship: "purchase relationship" }, confidence: 0.95 },
  { key: "customer", name: "Customer", summary: "Buys the organization's products/services.", content: { relationship: "sales relationship" }, confidence: 0.95 },
  { key: "partner", name: "Partner", summary: "Collaborates with the organization (channel, JV, strategic).", content: { relationship: "mutual benefit" }, confidence: 0.9 },
];

// --- 10. Universal business functions ----------------------------------------

export const BUSINESS_FUNCTIONS: Concept[] = [
  { key: "leadership", name: "Leadership", summary: "Sets direction, culture and decisions.", content: { typical: ["CEO", "COO", "board"] } },
  { key: "finance", name: "Finance", summary: "Planning, budgeting, treasury and reporting.", content: { typical: ["CFO", "controller"] } },
  { key: "accounting", name: "Accounting", summary: "Records transactions and produces statements.", content: { typical: ["accountant", "bookkeeper"] } },
  { key: "sales", name: "Sales", summary: "Wins and manages revenue-generating relationships.", content: { typical: ["AE", "SDR", "account manager"] } },
  { key: "marketing", name: "Marketing", summary: "Builds demand and brand.", content: { typical: ["marketing manager", "growth"] } },
  { key: "operations", name: "Operations", summary: "Runs the core delivery engine day-to-day.", content: { typical: ["ops manager", "dispatch"] } },
  { key: "customer_support", name: "Customer support", summary: "Handles inbound service and issue resolution.", content: { typical: ["support agent"] } },
  { key: "customer_success", name: "Customer success", summary: "Drives retention and value realization.", content: { typical: ["CSM"] } },
  { key: "hr", name: "HR", summary: "People operations: hire, pay, develop, offboard.", content: { typical: ["HR manager"] } },
  { key: "procurement", name: "Procurement", summary: "Buys goods and services from vendors.", content: { typical: ["buyer"] } },
  { key: "legal", name: "Legal", summary: "Contracts, compliance, risk and disputes.", content: { typical: ["general counsel"] } },
  { key: "compliance", name: "Compliance", summary: "Ensures adherence to rules and policies.", content: { typical: ["compliance officer"] } },
  { key: "it", name: "IT", summary: "Runs technology infrastructure and support.", content: { typical: ["sysadmin", "help desk"] } },
  { key: "product", name: "Product", summary: "Defines what is built and why.", content: { typical: ["PM"] } },
  { key: "engineering", name: "Engineering", summary: "Builds and maintains software/systems.", content: { typical: ["engineers"] } },
  { key: "production", name: "Production", summary: "Manufactures or delivers the core output.", content: { typical: ["production lead"] } },
  { key: "quality", name: "Quality", summary: "Ensures output meets standards.", content: { typical: ["QC inspector"] } },
  { key: "logistics", name: "Logistics", summary: "Moves materials and goods.", content: { typical: ["dispatcher"] } },
  { key: "supply_chain", name: "Supply chain", summary: "End-to-end sourcing to delivery.", content: { typical: ["supply chain manager"] } },
].map((c) => ({ ...c, confidence: 0.85 }));

// --- 11. Universal business objects ------------------------------------------

export const BUSINESS_OBJECTS: Concept[] = [
  { key: "organization", name: "Organization", summary: "The business itself.", content: { attributes: ["name", "industry", "size", "jurisdiction"] } },
  { key: "business_unit", name: "Business unit", summary: "A semi-independent division.", content: { attributes: ["name", "parent", "p&l"] } },
  { key: "department", name: "Department", summary: "A functional unit.", content: { attributes: ["name", "function"] } },
  { key: "employee", name: "Employee", summary: "A person employed by the organization.", content: { attributes: ["name", "role", "department"] } },
  { key: "customer", name: "Customer", summary: "A buyer of products/services.", content: { attributes: ["name", "type", "status"] } },
  { key: "lead", name: "Lead", summary: "A potential customer.", content: { attributes: ["name", "source", "status"] } },
  { key: "prospect", name: "Prospect", summary: "A qualified, engaged potential customer.", content: { attributes: ["name", "stage"] } },
  { key: "opportunity", name: "Opportunity", summary: "A potential sale being pursued.", content: { attributes: ["value", "stage", "owner"] } },
  { key: "quote", name: "Quote", summary: "A priced offer to a customer.", content: { attributes: ["amount", "status", "expires"] } },
  { key: "proposal", name: "Proposal", summary: "A detailed offer including scope and terms.", content: { attributes: ["version", "amount", "status"] } },
  { key: "contract", name: "Contract", summary: "A legally binding agreement.", content: { attributes: ["party", "value", "start", "end"] } },
  { key: "order", name: "Order", summary: "A confirmed purchase request.", content: { attributes: ["customer", "items", "status"] } },
  { key: "project", name: "Project", summary: "A scoped piece of work with a start and end.", content: { attributes: ["scope", "budget", "schedule"] } },
  { key: "task", name: "Task", summary: "A unit of work with an owner.", content: { attributes: ["assignee", "due", "status"] } },
  { key: "invoice", name: "Invoice", summary: "A billing document requesting payment.", content: { attributes: ["number", "amount", "due"] } },
  { key: "payment", name: "Payment", summary: "Money received against an invoice.", content: { attributes: ["amount", "date", "method"] } },
  { key: "refund", name: "Refund", summary: "Money returned to a customer.", content: { attributes: ["amount", "reason"] } },
  { key: "expense", name: "Expense", summary: "A cost incurred.", content: { attributes: ["amount", "category", "date"] } },
  { key: "purchase_order", name: "Purchase order", summary: "An order placed with a vendor.", content: { attributes: ["vendor", "amount", "status"] } },
  { key: "vendor", name: "Vendor", summary: "A supplier of goods/services.", content: { attributes: ["name", "terms", "status"] } },
  { key: "product", name: "Product", summary: "A sellable offering.", content: { attributes: ["name", "price", "cost"] } },
  { key: "service", name: "Service", summary: "A sellable performed offering.", content: { attributes: ["name", "rate", "deliverable"] } },
  { key: "asset", name: "Asset", summary: "Something owned of value.", content: { attributes: ["type", "value"] } },
  { key: "liability", name: "Liability", summary: "An obligation owed.", content: { attributes: ["type", "amount"] } },
  { key: "transaction", name: "Transaction", summary: "A recorded movement of value.", content: { attributes: ["amount", "date", "direction"] } },
  { key: "account", name: "Account", summary: "A customer or ledger relationship.", content: { attributes: ["name", "type", "balance"] } },
].map((c) => ({ ...c, confidence: 0.9 }));

/** Meaningful relationships among universal business objects. */
export const OBJECT_RELATIONSHIPS: Array<{ from: string; to: string; relationship: string; description: string }> = [
  { from: "lead", to: "opportunity", relationship: "converts_to", description: "A qualified lead becomes an opportunity being pursued." },
  { from: "opportunity", to: "quote", relationship: "produces", description: "An opportunity leads to a priced quote." },
  { from: "quote", to: "proposal", relationship: "expands_to", description: "A quote may expand into a full proposal." },
  { from: "proposal", to: "contract", relationship: "becomes", description: "An accepted proposal becomes a contract." },
  { from: "contract", to: "project", relationship: "spawns", description: "A contract may spawn one or more projects." },
  { from: "project", to: "task", relationship: "contains", description: "Projects decompose into tasks." },
  { from: "order", to: "invoice", relationship: "billed_by", description: "Delivered orders are billed via invoices." },
  { from: "invoice", to: "payment", relationship: "settled_by", description: "Invoices are settled by payments." },
  { from: "payment", to: "account", relationship: "posted_to", description: "Payments post to a customer or ledger account." },
  { from: "purchase_order", to: "vendor", relationship: "placed_with", description: "Purchase orders are placed with vendors." },
  { from: "vendor", to: "invoice", relationship: "issues", description: "Vendors issue invoices for delivered goods." },
  { from: "employee", to: "department", relationship: "belongs_to", description: "Employees belong to departments." },
  { from: "customer", to: "organization", relationship: "buys_from", description: "Customers transact with the organization." },
  { from: "product", to: "order", relationship: "line_item_of", description: "Products appear as line items on orders." },
  { from: "asset", to: "organization", relationship: "owned_by", description: "Assets belong to the organization." },
];

// --- 12. Universal business lifecycles ---------------------------------------

export const BUSINESS_LIFECYCLES: Array<{ key: string; name: string; description: string; stages: string[] }> = [
  {
    key: "sales",
    name: "Sales lifecycle",
    description: "Lead → opportunity → quote → sale → contract → delivery → invoice → payment → accounting.",
    stages: ["Lead", "Opportunity", "Quote", "Sale", "Contract", "Delivery", "Invoice", "Payment", "Accounting"],
  },
  {
    key: "procurement",
    name: "Procurement lifecycle",
    description: "Need → procurement → purchase order → delivery → vendor invoice → approval → payment.",
    stages: ["Need", "Procurement", "Purchase order", "Delivery", "Vendor invoice", "Approval", "Payment"],
  },
  {
    key: "employee",
    name: "Employee lifecycle",
    description: "Candidate → hire → onboarding → employment → performance → offboarding.",
    stages: ["Candidate", "Hire", "Onboarding", "Employment", "Performance", "Offboarding"],
  },
  {
    key: "customer",
    name: "Customer lifecycle",
    description: "Acquisition → onboarding → engagement → retention → expansion → (at risk) → churn/winback.",
    stages: ["Acquisition", "Onboarding", "Engagement", "Retention", "Expansion", "At risk", "Churn / winback"],
  },
];

// --- 13. Company maturity -----------------------------------------------------

export const COMPANY_MATURITY: Concept[] = [
  { key: "solo", name: "Solo", summary: "One person operating the entire business.", content: { scope: "everything is the owner", governance: "minimal — act on the few highest-impact risks", benchmark: "no enterprise process burden" }, confidence: 0.95 },
  { key: "micro", name: "Micro-business", summary: "A handful of people, simple structure.", content: { scope: "owner-led with 2–9 staff", governance: "lightweight checklists beat committees", benchmark: "cash flow + documentation hygiene" }, confidence: 0.95 },
  { key: "small", name: "Small business", summary: "Established operations, departmental basics.", content: { scope: "10–49 staff, role owners appear", governance: "formalize key processes (sales, delivery, finance)", benchmark: "margin and repeatability" }, confidence: 0.95 },
  { key: "mid_market", name: "Mid-market", summary: "Multiple functions, likely multiple locations.", content: { scope: "50–499 staff", governance: "defined policies, approval chains, controls", benchmark: "unit economics + governance" }, confidence: 0.95 },
  { key: "enterprise", name: "Enterprise", summary: "Large, multi-unit, complex governance.", content: { scope: "500+ staff, legal entities", governance: "full control frameworks, board oversight", benchmark: "risk + compliance + scale" }, confidence: 0.95 },
];

/** Adaptation guidance: what to recommend at each maturity level. */
export function maturityGuidance(sizeKey?: string | null): string {
  switch (sizeKey) {
    case "solo":
      return "Focus on cash, documentation and one repeatable process at a time — no enterprise governance overhead.";
    case "micro":
      return "Lightweight checklists and clear owner-of-record for the 3–5 processes that make or break cash flow.";
    case "small":
      return "Formalize sales → delivery → invoice → payment and documentation hygiene; designate process owners.";
    case "mid_market":
      return "Institute approval chains, controls and unit-economics reporting; multiple locations need per-location context.";
    case "enterprise":
      return "Full control frameworks, compliance and audit coverage; AI should reduce, never replace, controls.";
    default:
      return "Adapt recommendations to the company's actual maturity rather than assuming a process-heavy model.";
  }
}

/** The complete universal brain, versioned. */
export const BUSINESS_BRAIN = {
  version: "2026.1",
  businessTypes: BUSINESS_TYPES,
  financialKnowledge: FINANCIAL_KNOWLEDGE,
  ambiguousTerms: AMBIGUOUS_TERMS,
  orgStructures: ORG_STRUCTURES,
  orgRoles: ORG_ROLES,
  businessFunctions: BUSINESS_FUNCTIONS,
  businessObjects: BUSINESS_OBJECTS,
  objectRelationships: OBJECT_RELATIONSHIPS,
  lifecycles: BUSINESS_LIFECYCLES,
  maturity: COMPANY_MATURITY,
};

/** Dimension labels used by the organization context engine. */
export const BUSINESS_MODELS = BUSINESS_TYPES.map((b) => b.name);
export const MATURITY_KEYS = COMPANY_MATURITY.map((m) => m.key);
