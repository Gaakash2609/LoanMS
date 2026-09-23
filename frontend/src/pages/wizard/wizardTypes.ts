// Core wizard data shape — extracted verbatim from NewApplicationPage.tsx
// (code-quality refactor, no behaviour change). Shared by the Step
// components, the orchestrator, and the document machinery.

export interface WizardData {
  // Step 1
  mobile: string; pan: string; location: string; salesPerson: string
  channel: string; leadsrc: string; dsaName: string
  // Phase 2A — actual FK ids selected alongside the display fields above.
  dsaId: string; partnerId: string
  // Optional Partner linked under a DSA — Vanilla's #w-dsa-partner-group
  // "Linked Partner (optional)" (index.html:1538-1542). No dedicated backend
  // column, so it rides productData (stored as the partner id string).
  dsaLinkedPartner: string
  // Step 2 (KYC - manual entry in React version)
  kycFirstName: string; kycLastName: string; kycDob: string
  kycAadhar: string; kycGender: string; kycFather: string
  kycStreet1: string; kycCity: string; kycState: string; kycPin: string
  // Step 3 — Personal
  firstName: string; middleName: string; lastName: string
  dob: string; gender: string; aadhar: string; email: string; phone: string; father: string; mother: string
  // Step 4 — Address
  street1: string; street2: string; city: string; state: string; zip: string; homeType: string; sameAddr: boolean
  pStreet1: string; pStreet2: string; pCity: string; pState: string; pZip: string; pHomeType: string
  // Step 5 — Employment
  empType: string; compName: string; compType: string; salary: string; desig: string; officeEmail: string; obligations: string
  // Step 5 — self-employed / business detail (legacy's SEP/SENP field set)
  bizVintage: string; annualTurnover: string; netProfit: string; gstNumber: string; itrFiled: string
  // Vanilla captures the industry "Business Type" (Manufacturing/Trading/…)
  // separately from the legal Company/Business Type, for self-employed.
  bizType: string
  officeAddress: string
  // Vanilla captures office/workplace address as structured Line 1 / Line 2 /
  // PIN (required for salaried & professional), not one free-text field.
  officeAddr1: string; officeAddr2: string; officePin: string
  // Step 5 — professional registration (legacy shows for professional emp type)
  professionalBody: string
  // Step 5 — product-specific sections (legacy shows these per loan type)
  propertyType: string; propertyValue: string; propertyAddress: string        // Home Loan / LAP
  propertyCity: string; propertyOwnership: string; propertyUnderConstruction: string; builderSociety: string
  vehicleMake: string; vehicleModel: string; vehiclePrice: string             // New / Used Car
  vehicleMfgYear: string; vehicleExShowroom: string; vehicleKms: string; vehicleDealer: string
  courseName: string; instituteName: string; courseDuration: string           // Education
  studyLocation: string; admissionStatus: string
  coAppName: string; coAppRelation: string; coAppPan: string; coAppMobile: string
  // Vanilla's #w-coapplicant-email — Education-only, required (index.html:2249).
  coAppEmail: string
  // Step-3 co-applicant Aadhaar (Home Loan / LAP / Business Loan block).
  coAppAadhar: string
  // Step 6 — Insurance product (legacy replaces the whole loan-offer field
  // set with these when Loan Type = Insurance)
  insType: string; insSumAssured: string; insPolicyTerm: string
  insPremiumFreq: string; insPremium: string; insInsurer: string
  insNomineeName: string; insNomineeRelation: string; insNomineeDob: string; insNomineeId: string
  insExistingPolicy: string; insExistingInsurer: string; insExistingCover: string; insExistingPolicyNumber: string
  insHealthDeclared: string; insHealthNotes: string
  insTobaccoStatus: string; insHeight: string; insWeight: string; insOccupationHazard: string
  // Step 6 — Loan offer
  loanType: string; amount: string; loanRate: string; tenure: string; purpose: string; cibil: string
  // Step 7 — References (Vanilla captures a full address per reference:
  // Address Line 1/2, City, PIN — persisted via productData)
  r1Name: string; r1Mobile: string; r1Relation: string
  r1Addr1: string; r1Addr2: string; r1City: string; r1Pin: string
  r2Name: string; r2Mobile: string; r2Relation: string
  r2Addr1: string; r2Addr2: string; r2City: string; r2Pin: string
}

export const emptyData: WizardData = {
  mobile: '', pan: '', location: '', salesPerson: '', channel: '', leadsrc: '', dsaName: '',
  dsaId: '', partnerId: '', dsaLinkedPartner: '',
  kycFirstName: '', kycLastName: '', kycDob: '', kycAadhar: '', kycGender: '', kycFather: '',
  kycStreet1: '', kycCity: '', kycState: '', kycPin: '',
  firstName: '', middleName: '', lastName: '', dob: '', gender: '', aadhar: '', email: '', phone: '', father: '', mother: '',
  street1: '', street2: '', city: '', state: '', zip: '', homeType: '', sameAddr: false,
  pStreet1: '', pStreet2: '', pCity: '', pState: '', pZip: '', pHomeType: '',
  empType: '', compName: '', compType: '', salary: '', desig: '', officeEmail: '', obligations: '0',
  bizVintage: '', annualTurnover: '', netProfit: '', gstNumber: '', itrFiled: '', bizType: '', officeAddress: '',
  officeAddr1: '', officeAddr2: '', officePin: '',
  professionalBody: '',
  propertyType: '', propertyValue: '', propertyAddress: '',
  propertyCity: '', propertyOwnership: '', propertyUnderConstruction: 'no', builderSociety: '',
  vehicleMake: '', vehicleModel: '', vehiclePrice: '',
  vehicleMfgYear: '', vehicleExShowroom: '', vehicleKms: '', vehicleDealer: '',
  courseName: '', instituteName: '', courseDuration: '',
  studyLocation: '', admissionStatus: '',
  coAppName: '', coAppRelation: '', coAppPan: '', coAppMobile: '', coAppAadhar: '', coAppEmail: '',
  insType: '', insSumAssured: '', insPolicyTerm: '', insPremiumFreq: 'Yearly',
  insPremium: '', insInsurer: '', insNomineeName: '', insNomineeRelation: '',
  insNomineeDob: '', insNomineeId: '', insExistingPolicy: 'no', insExistingInsurer: '',
  insExistingCover: '', insExistingPolicyNumber: '', insHealthDeclared: 'no', insHealthNotes: '',
  insTobaccoStatus: '', insHeight: '', insWeight: '', insOccupationHazard: '',
  loanType: 'personal_loan', amount: '', loanRate: '12', tenure: '24', purpose: '', cibil: '',
  r1Name: '', r1Mobile: '', r1Relation: '', r1Addr1: '', r1Addr2: '', r1City: '', r1Pin: '',
  r2Name: '', r2Mobile: '', r2Relation: '', r2Addr1: '', r2Addr2: '', r2City: '', r2Pin: '',
}


// Reverse of buildPayload() below — used only when resuming a draft, to turn
// the server's response (GET /api/wizard/draft/{loanId}) back into wizard
// form state. FullName is split on the first/last space as a best-effort;
// the person can adjust it on Step 3 if the split isn't exact.

// Server-persisted mandatory document — id + name always present, fileRef when
// possible; older callers that only have {id, name} still work.
export type UploadedDocInfo = { id: number; name: string; fileRef?: string }
