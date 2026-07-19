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
    Task<Loan?> GetWithDetailsAsync(int id);
    Task<PagedResultDto<LoanListDto>> GetPagedAsync(LoanFilterDto filter, int? currentUserId = null, string? currentUserRole = null);
    Task<string> GenerateLoanNumberAsync();
    Task<DashboardStatsDto> GetDashboardStatsAsync(int? userId = null, string? role = null);
    Task<IEnumerable<Loan>> GetLoansByCustomerAsync(int customerId);
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
    Task<ApiResponseDto<LoanDto>> GetByIdAsync(int id, string callerRole = "Sales");
    Task<ApiResponseDto<PagedResultDto<LoanListDto>>> GetAllAsync(LoanFilterDto filter, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> CreateAsync(CreateLoanRequestDto request, int createdByUserId);
    Task<ApiResponseDto<LoanDto>> UpdateAsync(int id, UpdateLoanRequestDto request);
    Task<ApiResponseDto<LoanDto>> UpdateStatusAsync(int id, UpdateLoanStatusRequestDto request, int changedByUserId);
    Task<ApiResponseDto<bool>> DeleteAsync(int id);
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
}

public interface ICacheService
{
    Task<T?> GetAsync<T>(string key) where T : class;
    Task SetAsync<T>(string key, T value, TimeSpan? expiry = null) where T : class;
    Task RemoveAsync(string key);
    Task RemoveByPrefixAsync(string prefix);
}
