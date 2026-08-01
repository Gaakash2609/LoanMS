using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Ticket Comment / Activity ───────────────────────────────────────────────
// Phase 4B: backs the helpdesk ticket comment/notes/activity panel.
// Type "Comment" = user-authored note. Type "Activity" = system-generated
// record written automatically on status or assignment change (Close, Reopen,
// reassignment). Both share one table/timeline so the UI can render them in
// chronological order.
public class TicketComment : BaseEntity
{
    public int TicketId { get; set; }
    public int UserId { get; set; }
    public string Content { get; set; } = string.Empty;
    public string Type { get; set; } = "Comment";

    public Ticket Ticket { get; set; } = null!;
    public User User { get; set; } = null!;
}
