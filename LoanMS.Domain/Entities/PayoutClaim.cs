using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Payout Claim ──────────────────────────────────────────────────────────────
public class PayoutClaim : BaseEntity
{
    public int LoanId { get; set; }
    public int ClaimedByUserId { get; set; }
    public decimal ClaimAmount { get; set; }
    public string Status { get; set; } = "Pending";
    public string? Month { get; set; }
    public string? Notes { get; set; }
    public DateTime? VerifiedAt { get; set; }
    public DateTime? PaidAt { get; set; }
    public int? ProcessedByUserId { get; set; }

    /// <summary>
    /// Phase 3: the capacity in which ClaimedByUserId is claiming on this loan —
    /// "Sales" | "Dsa" | "Partner" | "Login" | "Manager" | "Admin". Lets the same
    /// loan carry one claim per eligible claimant (multi-claimant business logic)
    /// instead of a single claim per loan. Combined with (LoanId, ClaimedByUserId)
    /// this forms the idempotency key that prevents duplicate claims — see the
    /// unique index in AppDbContext.
    /// </summary>
    public string ClaimType { get; set; } = "Sales";

    // ── Payment details (captured when a claim is marked Paid) ──────────
    // These back the legacy Claim Status/Payment modal's fields, which
    // previously had nowhere to live: the claim carried only Status/Notes/
    // PaidAt, so mode/UTR/account were being folded into the free-text
    // Notes column and could not be filtered or reported on. All nullable
    // — a claim only has them once it is actually paid.
    public string? PaymentMode { get; set; }
    public string? PaymentReference { get; set; }
    public DateTime? PaymentDate { get; set; }
    public string? BankAccountLast4 { get; set; }

    // ── Claim-form detail fields (legacy CLAIMS modal — efin-app.js submitClaim /
    // openClaimEdit + index.html cl-* inputs) ──────────────────────────────────
    // In legacy these were collected + validated in the modal but never persisted:
    // the submit path only sent {loanId, month, notes} to the server, so banker/
    // ASM/business-category/etc. evaporated on refresh (and edit was in-memory-
    // only). They live here now so a submitted claim keeps its full detail. All
    // nullable (only a subset are required client-side). NOTE: the modal's "Claim
    // Month" maps to Month above and "Vendor Remark" maps to Notes above — no
    // duplicate columns for those.
    public string? UserType { get; set; }              // cl-user-type: individual | company
    public string? DsaMobile { get; set; }             // cl-dsa-mobile
    public string? Contests { get; set; }              // cl-contests
    public string? BankName { get; set; }              // cl-bank
    public string? ProductName { get; set; }           // cl-product
    public string? FirstName { get; set; }             // cl-fname
    public string? LastName { get; set; }              // cl-lname
    public string? LoanNumberRef { get; set; }         // cl-loan-num (free-text, distinct from the Loan FK)
    public string? ApacRef { get; set; }               // cl-apac
    public string? CompanyName { get; set; }           // cl-company
    public decimal? DisbursementAmount { get; set; }   // cl-disb-amount (claimant-entered; distinct from ClaimAmount)
    public DateTime? DisbursementDate { get; set; }    // cl-disb-date
    public string? City { get; set; }                  // cl-city
    public string? BusinessCategory { get; set; }      // cl-biz-cat
    public bool ConfirmationRequired { get; set; }     // cl-confirmation
    public bool SplitCase { get; set; }                // cl-split-case
    public string? BankerEmail { get; set; }           // cl-banker-email
    public string? BankerName { get; set; }            // cl-banker-name
    public string? BankerMobile { get; set; }          // cl-banker-mobile
    public string? AsmEmail { get; set; }              // cl-asm-email
    public string? AsmName { get; set; }               // cl-asm-name
    public string? AsmMobile { get; set; }             // cl-asm-mobile

    public Loan Loan { get; set; } = null!;
    public User ClaimedBy { get; set; } = null!;
    public User? ProcessedBy { get; set; }
}
