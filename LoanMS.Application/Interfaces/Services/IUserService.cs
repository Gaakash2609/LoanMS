using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface IUserService
{
    Task<ApiResponseDto<UserDto>> GetByIdAsync(int id);
    Task<ApiResponseDto<IEnumerable<UserDto>>> GetAllAsync();
    Task<ApiResponseDto<IEnumerable<UserLookupDto>>> GetLookupAsync();
    Task<ApiResponseDto<UserDto>> CreateAsync(CreateUserRequestDto request);
    Task<ApiResponseDto<UserDto>> UpdateAsync(int id, UpdateUserRequestDto request);
    Task<ApiResponseDto<bool>> DeleteAsync(int id);
    Task<ApiResponseDto<bool>> ChangePasswordAsync(int id, ChangePasswordRequestDto request);
    Task<ApiResponseDto<bool>> AdminResetPasswordAsync(int targetUserId, AdminResetPasswordRequestDto request);
}
