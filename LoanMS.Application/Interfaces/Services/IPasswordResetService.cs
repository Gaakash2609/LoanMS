using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface IPasswordResetService
{
    Task<ApiResponseDto<bool>> ForgotPasswordAsync(ForgotPasswordRequestDto request);
    Task<ApiResponseDto<bool>> ResetPasswordAsync(ResetPasswordRequestDto request);
}
