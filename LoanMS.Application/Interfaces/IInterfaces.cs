using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

// ── Repositories ──────────────────────────────────────────────────────────────

public interface IGenericRepository<T> where T : BaseEntity
{
    Task<T?> GetByIdAsync(int id);
    Task<IEnumerable<T>> GetAllAsync();
    Task<T> AddAsync(T entity);
    Task<T> UpdateAsync(T entity);
    Task DeleteAsync(int id);
    Task<bool> ExistsAsync(int id);
}

public interface IUserRepository : IGenericRepository<User>
{
    Task<User?> GetByEmailAsync(string email);
    Task<User?> GetByRefreshTokenAsync(string refreshToken);
    Task<IEnumerable<User>> GetAllActiveUsersAsync();
    Task<bool> EmailExistsAsync(string email, int? excludeId = null);
}

public interface ICustomerRepository : IGenericRepository<Customer>
{
    Task<Customer?> GetWithLoansAsync(int id);
    Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search);
    Task<bool> EmailExistsAsync(string email, int? excludeId = null);
    Task<bool> PanExistsAsync(string pan, int? excludeId = null);
}

public interface ILoanRepository : IGenericRepository<Loan>
{
    // Phase 2B: currentUserId/currentUserRole are optional so internal callers
    // (post-create/update refetch, AI service) keep their existing unrestricted
    // behavior. Pass both when serving a caller-facing "detail by id" request so
    // the same role-based visibility scope used in GetPagedAsync is enforced —
    // this is what blocks direct loanId-swap access to someone else's loan.
    Task<Loan?> GetWithDetailsAsync(int id, int? currentUserId = null, string? currentUserRole = null);
    Task<PagedResultDto<LoanListDto>> GetPagedAsync(LoanFilterDto filter, int? currentUserId = null, string? currentUserRole = null);
    Task<string> GenerateLoanNumberAsync();
    Task<DashboardStatsDto> GetDashboardStatsAsync(int? userId = null, string? role = null);
    Task<IEnumerable<Loan>> GetLoansByCustomerAsync(int customerId);
    // Phase 3A: reuses the same ApplyVisibilityScope rules that gate the list/
    // detail endpoints (Phase 2B) — the single source of truth for "can this
    // user see/act on this loan", now also used to gate Update/UpdateStatus/
    // Submit/Approve/Reject/Delete before any write happens.
    Task<bool> HasAccessAsync(int loanId, int currentUserId, string? currentUserRole);
}

public interface ILoanStatusHistoryRepository : IGenericRepository<LoanStatusHistory>
{
    Task<IEnumerable<LoanStatusHistory>> GetByLoanIdAsync(int loanId);
}

public interface IUnitOfWork : IDisposable
{
    IUserRepository Users { get; }
    ICustomerRepository Customers { get; }
    ILoanRepository Loans { get; }
    ILoanStatusHistoryRepository LoanStatusHistories { get; }
    IPasswordResetTokenRepository PasswordResetTokens { get; }
    Task<int> SaveChangesAsync();
}

// ── Services ──────────────────────────────────────────────────────────────────

public interface IAuthService
{
    Task<ApiResponseDto<LoginResponseDto>> LoginAsync(LoginRequestDto request);
    Task<ApiResponseDto<LoginResponseDto>> RefreshTokenAsync(string refreshToken);
    Task<ApiResponseDto<bool>> LogoutAsync(int userId);
    string HashPassword(string password);
    bool VerifyPassword(string password, string hash);
}

public interface IUserService
{
    Task<ApiResponseDto<UserDto>> GetByIdAsync(int id);
    Task<ApiResponseDto<IEnumerable<UserDto>>> GetAllAsync();
    Task<ApiResponseDto<IEnumerable<UserLookupDto>>> GetLookupAsync();
    Task<ApiResponseDto<UserDto>> CreateAsync(CreateUserRequestDto request);
    Task<ApiResponseDto<UserDto>> UpdateAsync(int id, UpdateUserRequestDto request);
    Task<ApiResponseDto<bool>> DeleteAsync(int id);
    Task<ApiResponseDto<bool>> ChangePasswordAsync(int id, ChangePasswordRequestDto request);
}

public interface ICustomerService
{
    Task<ApiResponseDto<CustomerDto>> GetByIdAsync(int id, string callerRole = "Sales");
    Task<ApiResponseDto<PagedResultDto<CustomerDto>>> GetAllAsync(int page, int pageSize, string? search);
    Task<ApiResponseDto<CustomerDto>> CreateAsync(CreateCustomerRequestDto request);
    Task<ApiResponseDto<CustomerDto>> UpdateAsync(int id, UpdateCustomerRequestDto request);
    Task<ApiResponseDto<bool>> DeleteAsync(int id);
    Task<bool> PanExistsAsync(string pan, int? excludeId = null);
    Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search);
}

public interface ILoanService
{
    // Phase 2B: currentUserId is required now (not defaulted) so every detail-by-id
    // lookup is checked against the caller's role-based visibility scope —
    // changing the loanId in the URL to someone else's loan must return "not found".
    Task<ApiResponseDto<LoanDto>> GetByIdAsync(int id, int currentUserId, string callerRole = "Sales");
    Task<ApiResponseDto<PagedResultDto<LoanListDto>>> GetAllAsync(LoanFilterDto filter, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> CreateAsync(CreateLoanRequestDto request, int createdByUserId);
    // Phase 3A: every action on an existing loan now takes the caller's id/role
    // (always sourced from the JWT via BaseController — never from the request
    // body) and verifies access via ILoanRepository.HasAccessAsync before acting.
    Task<ApiResponseDto<LoanDto>> UpdateAsync(int id, UpdateLoanRequestDto request, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> UpdateStatusAsync(int id, UpdateLoanStatusRequestDto request, int changedByUserId, string changedByUserRole);
    Task<ApiResponseDto<bool>> DeleteAsync(int id, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<DashboardStatsDto>> GetDashboardStatsAsync(int userId, string role);
}

public interface IJwtService
{
    string GenerateAccessToken(User user);
    string GenerateRefreshToken();
    int? GetUserIdFromToken(string token);
}

public interface IPasswordResetTokenRepository : IGenericRepository<PasswordResetToken>
{
    Task<PasswordResetToken?> GetValidTokenAsync(string tokenHash);
    Task InvalidateAllForUserAsync(int userId);
}

public interface IPasswordResetService
{
    Task<ApiResponseDto<bool>> ForgotPasswordAsync(ForgotPasswordRequestDto request);
    Task<ApiResponseDto<bool>> ResetPasswordAsync(ResetPasswordRequestDto request);
}

public interface IEmailService
{
    Task SendPasswordResetEmailAsync(string toEmail, string toName, string resetLink);

    /// <summary>
    /// Generic, template-agnostic send — the single choke point every email call site
    /// (invitation, loan approval/rejection/disbursement, EMI reminders, document
    /// requests, stage-change notices, etc.) now routes through. Config (provider,
    /// credentials, from-address) is resolved server-side from the DB-backed
    /// IEmailConfigStore, so the browser never needs to hold SMTP/Brevo secrets.
    /// </summary>
    Task SendAsync(string toEmail, string toName, string subject, string htmlBody, string? cc = null, string? replyTo = null);

    /// <summary>
    /// Sends a one-off test email using the currently-saved configuration and
    /// returns a real success/failure + human-readable error, so Settings → Mail &
    /// Email can verify delivery without relying on the "always succeeds" semantics
    /// of the self-service forgot-password flow.
    /// </summary>
    Task<(bool Success, string? Error)> SendTestEmailAsync(string toEmail);
}

public interface ICacheService
{
    Task<T?> GetAsync<T>(string key) where T : class;
    Task SetAsync<T>(string key, T value, TimeSpan? expiry = null) where T : class;
    Task RemoveAsync(string key);
    Task RemoveByPrefixAsync(string prefix);
}
