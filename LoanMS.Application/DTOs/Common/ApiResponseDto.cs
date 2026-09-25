using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class ApiResponseDto<T>
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public T? Data { get; set; }
    public List<string> Errors { get; set; } = new();
    /// <summary>Machine-readable failure reason (see ApiErrorCodes). Null on
    /// success and on every older failure path; set only where the API must
    /// answer with a specific HTTP status (409/403/404) — see BaseController.ApiResult.</summary>
    public string? ErrorCode { get; set; }

    public static ApiResponseDto<T> Ok(T data, string? message = null) =>
        new() { Success = true, Data = data, Message = message };

    public static ApiResponseDto<T> Fail(string error) =>
        new() { Success = false, Errors = new List<string> { error } };

    public static ApiResponseDto<T> Fail(List<string> errors) =>
        new() { Success = false, Errors = errors };

    public static ApiResponseDto<T> Fail(string error, string errorCode) =>
        new() { Success = false, Message = error, Errors = new List<string> { error }, ErrorCode = errorCode };
}

/// <summary>ApiResponseDto.ErrorCode values for the duplicate-customer /
/// re-application / archive rules, and the HTTP status each maps to.</summary>
public static class ApiErrorCodes
{
    public const string ActiveApplicationExists = "ACTIVE_APPLICATION_EXISTS";
    public const string ReapplyCooldown         = "REAPPLY_COOLDOWN";
    public const string RejectionDateUnknown    = "REJECTION_DATE_UNKNOWN";
    public const string CustomerNeedsReview     = "CUSTOMER_NEEDS_REVIEW";
    public const string CustomerExists          = "CUSTOMER_EXISTS";
    public const string ArchiveNotAllowed       = "ARCHIVE_NOT_ALLOWED";
    public const string ApplicationArchived     = "APPLICATION_ARCHIVED";
    public const string ReasonRequired          = "REASON_REQUIRED";
    public const string Forbidden               = "FORBIDDEN";
    public const string NotFound                = "NOT_FOUND";
    // Offer → Sanction → Disbursement workflow
    public const string WorkflowStage           = "WORKFLOW_STAGE";         // action not allowed at the application's stage
    public const string OfferLimit              = "OFFER_LIMIT";            // 3 active offers / duplicate lender
    public const string ConcurrencyConflict     = "CONCURRENCY_CONFLICT";   // stale version / lost race
    public const string DeviationUnresolved     = "DEVIATION_UNRESOLVED";
    public const string SelfApproval            = "SELF_APPROVAL";
    public const string RuleConflict            = "RULE_CONFLICT";
    public const string Validation              = "VALIDATION";

    /// <summary>Business-rule conflicts → 409.</summary>
    public static bool IsConflict(string? code) => code is ActiveApplicationExists or ReapplyCooldown
        or RejectionDateUnknown or CustomerNeedsReview or CustomerExists or ArchiveNotAllowed or ApplicationArchived
        or WorkflowStage or OfferLimit or ConcurrencyConflict or DeviationUnresolved or RuleConflict;
}
