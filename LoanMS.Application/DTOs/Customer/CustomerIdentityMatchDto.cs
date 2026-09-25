namespace LoanMS.Application.DTOs;

public enum CustomerIdentityOutcome
{
    /// <summary>No existing customer carries any of the supplied identifiers.</summary>
    New,
    /// <summary>Every supplied identifier that matched points at the same live customer.</summary>
    Matched,
    /// <summary>Identifiers point at different customers (or contradict the
    /// matched customer's PAN). Never merged — needs admin review.</summary>
    Conflict,
    /// <summary>The only match is a soft-deleted customer. Not silently
    /// restored — needs admin review.</summary>
    DeletedMatch
}

/// <summary>Result of CustomerService.ResolveIdentityAsync — the single, global
/// (not user-scoped) customer identification used by every path that creates
/// or links a customer.</summary>
public class CustomerIdentityMatchDto
{
    public CustomerIdentityOutcome Outcome { get; set; }
    /// <summary>The customer to use (Matched), else null.</summary>
    public int? CustomerId { get; set; }
    /// <summary>True when CustomerId is an existing master record (not a
    /// provisional record created by this same draft): its identity/KYC fields
    /// may only be filled when blank, never overwritten.</summary>
    public bool IsExistingMaster { get; set; }
    /// <summary>The draft's own provisional customer that is superseded because
    /// the typed identifiers belong to an existing customer (the draft is
    /// re-linked to CustomerId and this unused record is removed).</summary>
    public int? SupersededProvisionalCustomerId { get; set; }
    public List<int> MatchedCustomerIds { get; set; } = new();
    public string? Message { get; set; }

    public bool NeedsReview => Outcome is CustomerIdentityOutcome.Conflict or CustomerIdentityOutcome.DeletedMatch;
}

/// <summary>Identity columns of one customer (soft-deleted rows included).</summary>
public class CustomerIdentityRow
{
    public int Id { get; set; }
    public bool IsDeleted { get; set; }
    public string? PanNormalized { get; set; }
    public string? PhoneNormalized { get; set; }
    public string? EmailNormalized { get; set; }
}
