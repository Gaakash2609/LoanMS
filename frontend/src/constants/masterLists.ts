// ── Loan Form Dropdown Lists (Settings → System & Data) ─────────────────
// Transcribed from legacy's MASTER_LISTS (efin-app.js:25431). These feed the
// application wizard's dropdowns; wizardId records which field each one fills.
//
// Two of the five carry no items on purpose. Legacy emptied "location" and
// "sales_person" deliberately — their real data lives in the Locations and
// Users screens, and legacy's own mlSyncLocationsToTw() pushed FROM this list
// INTO twLocations, which is exactly the duplicate-source-of-truth problem the
// emptying was meant to end. They are shown here (legacy shows them too) but
// marked "sourcedElsewhere", so this editor never becomes a second place where
// that data can be created.

export interface MasterListItem {
  value: string
  label: string
}

export interface MasterListDef {
  key: string
  label: string
  icon: string
  desc: string
  /** The wizard field this list populates. */
  wizardId: string
  /** True when the real records are owned by another screen — read-only here. */
  sourcedElsewhere: boolean
  defaults: MasterListItem[]
}

/** The AppSettings key legacy saves the whole map under. */
export const MASTER_LISTS_SETTING_KEY = 'efin_master_lists'
export const MASTER_LISTS_SETTING_CATEGORY = 'MasterLists'

export const MASTER_LIST_DEFS: MasterListDef[] = [
  {
    key: "location",
    label: "Location",
    icon: "📍",
    desc: "Step 1 — branch / city locations for assignment",
    wizardId: "w-location",
    sourcedElsewhere: true,
    defaults: [
    ],
  },
  {
    key: "sales_person",
    label: "Sales Person",
    icon: "👤",
    desc: "Step 1 — sales persons available for assignment",
    wizardId: "w-sales",
    sourcedElsewhere: true,
    defaults: [
    ],
  },
  {
    key: "home_type",
    label: "Home Type",
    icon: "🏠",
    desc: "Step 4 — residential / accommodation type",
    wizardId: "w-hometype",
    sourcedElsewhere: false,
    defaults: [
      { value: "OWNED_SELF_SPOUSE", label: "Owned by Self / Spouse" },
      { value: "OWNED_BY_PARENTS", label: "Owned by Parents" },
      { value: "RENTED_SELF_WITH_FAMILY", label: "Rented (Self with Family)" },
      { value: "PAYING_GUEST_PL", label: "Paying Guest" },
      { value: "COMPANY_ACCOMMODATION", label: "Company Accommodation" },
    ],
  },
  {
    key: "designation",
    label: "Designation",
    icon: "💼",
    desc: "Step 5 — job title / designation options",
    wizardId: "w-desig",
    sourcedElsewhere: false,
    defaults: [
      { value: "manager", label: "Manager" },
      { value: "executive", label: "Executive" },
      { value: "ENGINEER", label: "Engineer" },
      { value: "Admin", label: "Admin Staff" },
      { value: "teacher", label: "Teacher" },
      { value: "doctor", label: "Doctor" },
      { value: "business", label: "Business Owner" },
      { value: "accountant", label: "Accountant" },
      { value: "analyst", label: "Analyst" },
      { value: "director", label: "Director" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "company_type",
    label: "Company Type",
    icon: "🏢",
    desc: "Step 5 — type of employer / company",
    wizardId: "w-comptype",
    sourcedElsewhere: false,
    defaults: [
      { value: "plcc", label: "Private Limited" },
      { value: "plc", label: "Public Limited" },
      { value: "cg", label: "Central Govt." },
      { value: "st_govt", label: "State Govt." },
      { value: "psu", label: "PSU / Public Sector" },
      { value: "mnc", label: "MNC" },
      { value: "llp", label: "LLP" },
      { value: "partner", label: "Partnership Firm" },
      { value: "prop", label: "Proprietorship" },
      { value: "ngo", label: "NGO / Trust" },
      { value: "other", label: "Other" },
    ],
  },
]

/** Where a  list is actually maintained. */
export const SOURCE_SCREEN: Record<string, { label: string; path: string }> = {
  location:     { label: 'Locations', path: '/locations' },
  sales_person: { label: 'Users', path: '/users' },
}
