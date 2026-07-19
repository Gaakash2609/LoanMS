using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LoanMS.API.Controllers;

[Authorize]
public class CustomersController : BaseController
{
    private readonly ICustomerService _customerService;

    public CustomersController(ICustomerService customerService) =>
        _customerService = customerService;

    /// <summary>Get all customers (paged + search)</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 10,
        [FromQuery] string? search = null)
    {
        if (page < 1) page = 1;
        if (pageSize is < 1 or > 100) pageSize = 10;

        var result = await _customerService.GetAllAsync(page, pageSize, search);
        return Ok(result);
    }

    /// <summary>Get customer by ID</summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var result = await _customerService.GetByIdAsync(id, CurrentUserRole);
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
        if (!result.Success) return BadRequest(result);
        return CreatedAtAction(nameof(GetById), new { id = result.Data!.Id }, result);
    }

    /// <summary>Update customer</summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateCustomerRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<CustomerDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _customerService.UpdateAsync(id, request);
        return ApiResult(result);
    }

    /// <summary>Delete customer [Manager/Admin only]</summary>
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Delete(int id)
    {
        var result = await _customerService.DeleteAsync(id);
        return ApiResult(result);
    }

    /// <summary>Check if PAN already exists — call before wizard submit</summary>
    [HttpGet("check-pan")]
    public async Task<IActionResult> CheckPan([FromQuery] string pan, [FromQuery] int? excludeId = null)
    {
        if (string.IsNullOrWhiteSpace(pan) || pan.Length != 10)
            return BadRequest(ApiResponseDto<object>.Fail("Invalid PAN format."));
        
        var exists = await _customerService.PanExistsAsync(pan.ToUpper().Trim(), excludeId);
        return Ok(ApiResponseDto<object>.Ok(new { exists, pan = pan.ToUpper().Trim() }));
    }

    /// <summary>Search customers by name/phone/PAN for wizard autofill</summary>
    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string q)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Length < 3)
            return BadRequest(ApiResponseDto<object>.Fail("Search query must be at least 3 characters."));
        
        var result = await _customerService.GetPagedAsync(1, 10, q);
        return Ok(ApiResponseDto<object>.Ok(result.Items));
    }

}