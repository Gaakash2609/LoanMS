using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LoanMS.API.Controllers;

[Authorize]
public class CustomersController : BaseController
{
    private readonly ICustomerService _customerService;
    private readonly ICustomerDeletionService _deletion;

    public CustomersController(ICustomerService customerService, ICustomerDeletionService deletion)
    {
        _customerService = customerService;
        _deletion = deletion;
    }

    /// <summary>Get all customers (paged + search)</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        [FromQuery] string? search = null)
    {
        if (page < 1) page = 1;
        if (pageSize is < 1 or > 100) pageSize = 10;

        var result = await _customerService.GetAllAsync(page, pageSize, search, CurrentUserId, CurrentUserRole);
        return Ok(result);
    }

    /// <summary>
    /// Get customer by ID. Role-based visibility is enforced server-side (see
    /// ICustomerRepository.GetWithLoansAsync) — passing someone else's
    /// customerId here returns 404, not the customer's data.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var result = await _customerService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    /// <summary>Create new customer</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateCustomerRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<CustomerDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _customerService.CreateAsync(request);
        // Existing / needs-review identity → 409 (ApiResult maps ErrorCode).
        if (!result.Success) return ApiResult(result);
        return CreatedAtAction(nameof(GetById), new { id = result.Data!.Id }, result);
    }

    /// <summary>Update customer</summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateCustomerRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<CustomerDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        // Same visibility rule as GET /api/customers/{id} — a customer outside
        // the caller's scope must not be editable by guessing its id.
        if (!(await _customerService.GetByIdAsync(id, CurrentUserId, CurrentUserRole)).Success)
            return NotFound(ApiResponseDto<CustomerDto>.Fail("Customer not found."));
        var result = await _customerService.UpdateAsync(id, request);
        return ApiResult(result);
    }

    /// <summary>
    /// PERMANENT delete of a customer and everything linked to them — loans,
    /// documents (DB rows + stored files), bureau data, payout claims, history,
    /// notifications and audit entries (see CustomerDeletionService). Admin only
    /// (owner decision 2026-09-23); Admin's scope is every customer, so no
    /// per-customer scope check is needed. Customers with an active loan are
    /// still refused (existing rule).
    /// </summary>
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var result = await _deletion.DeletePermanentlyAsync(id, HttpContext.RequestAborted);
        if (!result.Success && result.Errors.Contains("Customer not found."))
            return NotFound(result);
        return ApiResult(result);
    }

    /// <summary>
    /// Does a customer with this PAN / mobile / email already exist? GLOBAL (not
    /// limited to the caller's own customers) and on normalised values — the
    /// same identification the wizard uses. Deliberately returns no customer
    /// data (no id, name or contact details), only whether a match exists and
    /// whether it is ambiguous, so it can't be used to look people up.
    /// "check-mobile" is the same check addressed by mobile.
    /// </summary>
    [HttpGet("check-pan")]
    [HttpGet("check-mobile")]
    public async Task<IActionResult> CheckPan([FromQuery] string? pan = null, [FromQuery] int? excludeId = null,
        [FromQuery] string? mobile = null, [FromQuery] string? email = null)
    {
        var panKey = LoanMS.Domain.Entities.Customer.NormalizePan(pan);
        var mobileKey = LoanMS.Domain.Entities.Customer.NormalizeMobile(mobile);
        var emailKey = LoanMS.Domain.Entities.Customer.NormalizeEmail(email);
        if (!string.IsNullOrWhiteSpace(pan) && panKey == null)
            return BadRequest(ApiResponseDto<object>.Fail("Invalid PAN format."));
        if (!string.IsNullOrWhiteSpace(mobile) && mobileKey == null)
            return BadRequest(ApiResponseDto<object>.Fail("Invalid mobile number."));
        if (panKey == null && mobileKey == null && emailKey == null)
            return BadRequest(ApiResponseDto<object>.Fail("Provide a PAN, mobile number or email to check."));

        var identity = await _customerService.ResolveIdentityAsync(panKey, mobileKey, emailKey);
        var matchIds = identity.MatchedCustomerIds.Where(i => excludeId == null || i != excludeId.Value).ToList();
        var exists = identity.Outcome != LoanMS.Application.DTOs.CustomerIdentityOutcome.New && matchIds.Count > 0;
        var matchStatus = !exists ? "none" : identity.NeedsReview ? "needsReview" : "match";
        return Ok(ApiResponseDto<object>.Ok(new { exists, pan = panKey, mobile = mobileKey, matchStatus }));
    }

    /// <summary>Search customers by name/phone/PAN for wizard autofill</summary>
    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 3)
            return BadRequest(ApiResponseDto<object>.Fail("Search query must be at least 3 characters."));
        
        var result = await _customerService.GetPagedAsync(1, 10, q, CurrentUserId, CurrentUserRole);
        return Ok(ApiResponseDto<object>.Ok(result.Items));
    }

}