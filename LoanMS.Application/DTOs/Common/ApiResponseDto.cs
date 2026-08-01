using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class ApiResponseDto<T>
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public T? Data { get; set; }
    public List<string> Errors { get; set; } = new();

    public static ApiResponseDto<T> Ok(T data, string? message = null) =>
        new() { Success = true, Data = data, Message = message };

    public static ApiResponseDto<T> Fail(string error) =>
        new() { Success = false, Errors = new List<string> { error } };

    public static ApiResponseDto<T> Fail(List<string> errors) =>
        new() { Success = false, Errors = errors };
}
