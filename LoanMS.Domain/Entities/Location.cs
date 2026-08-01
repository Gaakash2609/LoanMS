using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Location ──────────────────────────────────────────────────────────────────
public class Location : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public string? PinCode { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<User> Users { get; set; } = new List<User>();
}
