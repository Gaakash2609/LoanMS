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
}
