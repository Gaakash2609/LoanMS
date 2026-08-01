using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface IAuthService
{
    Task<ApiResponseDto<LoginResponseDto>> LoginAsync(LoginRequestDto request);
    Task<ApiResponseDto<LoginResponseDto>> RefreshTokenAsync(string refreshToken);
    Task<ApiResponseDto<bool>> LogoutAsync(int userId);
    string HashPassword(string password);
    bool VerifyPassword(string password, string hash);
}
