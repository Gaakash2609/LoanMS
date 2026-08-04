namespace LoanMS.Application.DTOs;

public class UpdateReportTargetRequestDto
{
    // TargetMonth / UserId / TeamId are intentionally NOT editable via PUT —
    // the Target Editor UI only ever changes the three numeric targets for
    // an existing month row; changing the month itself would just create a
    // duplicate of another row and fight the unique index. Deleting and
    // re-adding a row is how the UI already handles moving to a new month.
    public decimal DisbAmt { get; set; }
    public int LoginCount { get; set; }
    public int DisbCount { get; set; }
}
