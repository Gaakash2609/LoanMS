namespace LoanMS.Application.DTOs;

/// <summary>
/// Self-service profile update — the logged-in user updating their own
/// PhoneNumber/PhotoData (PUT /api/users/profile). Deliberately narrower
/// than UpdateUserRequestDto (no Role/IsActive/FullName) since this
/// endpoint requires no Admin authorization — a user can only ever touch
/// their own record, identified via CurrentUserId from the JWT.
/// </summary>
public class UpdateProfileRequestDto
{
    public string? PhoneNumber { get; set; }

    /// <summary>Base64 image data URL (e.g. "data:image/png;base64,...").
    /// Null/empty clears the photo. No explicit length cap here — images
    /// are already client-side compressed by the upload flow; the column
    /// itself is unbounded text.</summary>
    public string? PhotoData { get; set; }

    // Address + Bank Details tabs — same self-service, own-record-only
    // convention as PhoneNumber/PhotoData above.
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? AddressCity { get; set; }
    public string? AddressState { get; set; }
    public string? AddressPostalCode { get; set; }
    public string? BankAccountHolderName { get; set; }
    public string? BankName { get; set; }
    public string? BankAccountType { get; set; }
    public string? BankAccountNumber { get; set; }
    public string? BankIfscCode { get; set; }
}
