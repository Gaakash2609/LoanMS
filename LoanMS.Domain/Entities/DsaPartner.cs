using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── DSA Partner ───────────────────────────────────────────────────────────────
public class DsaPartner : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? City { get; set; }
    public bool IsActive { get; set; } = true;
    public int? MappedSalesUserId { get; set; }

    /// <summary>Whether this record represents a DSA or a Partner.</summary>
    public PartnerType PartnerType { get; set; } = PartnerType.Dsa;
    /// <summary>Optional link to the real User account (role Dsa/Partner) that this
    /// DSA/Partner record logs in as. Nullable — a DSA/Partner can exist without
    /// a linked login.</summary>
    public int? LinkedUserId { get; set; }

    // ── Phase 2: fields previously local-only (frontend efin-app.js dsa-f-*/pm-f-*) ──
    /// <summary>PAN card number (frontend: dsa-f-pan).</summary>
    public string? Pan { get; set; }
    /// <summary>Office address line (frontend: dsa-f-office-addr).</summary>
    public string? OfficeAddress { get; set; }
    /// <summary>Office state (frontend: dsa-f-office-state). Office city already
    /// covered by <see cref="City"/>.</summary>
    public string? OfficeState { get; set; }
    /// <summary>Office PIN code (frontend: dsa-f-office-pin).</summary>
    public string? OfficePin { get; set; }
    /// <summary>Office address type — e.g. owned/rented (frontend: dsa-f-office-addr-type).</summary>
    public string? OfficeAddressType { get; set; }
    /// <summary>Partner sub-category — e.g. individual/company (frontend: pm-f-type).
    /// Distinct from <see cref="PartnerType"/>, which distinguishes DSA vs Partner.</summary>
    public string? Category { get; set; }
    /// <summary>For records where PartnerType = Partner: the DSA this Partner is
    /// mapped under (frontend: pm-f-dsa-id / mappedDsaId). Self-referencing FK.</summary>
    public int? MappedDsaId { get; set; }

    public User? MappedSalesUser { get; set; }
    public User? LinkedUser { get; set; }
    public DsaPartner? MappedDsa { get; set; }
    public ICollection<DsaDocument> Documents { get; set; } = new List<DsaDocument>();
}
