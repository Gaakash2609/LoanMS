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

    // Short, unique code used to build Employee Codes (MH-{ROLE}-{LOCATION}-
    // {RANDOM4}) — e.g. "HO", "AND", "KOT". Distinct from Name (which can be
    // long/freeform); this stays short and stable even if Name is edited
    // later, since Employee Codes must never change retroactively.
    public string Code { get; set; } = string.Empty;

    public ICollection<User> Users { get; set; } = new List<User>();
}
