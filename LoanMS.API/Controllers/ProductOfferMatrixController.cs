using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Product Offer Matrix (Policy & Product page) — full database persistence ─
// Was frontend-only (localStorage key 'efin_product_cam_v2'). Mirrors
// EmailTemplatesController: read open to any authenticated user (the offer
// calculator needs this for every role that can generate a first offer),
// mutations Admin + ProductTeam. Matrix shape is product-specific and already
// fully defined/validated client-side, so it's stored as an opaque JSON blob
// rather than modeled relationally.
// ProductTeam added per the business owner: Product Team gets full rights
// over the Wizard Offers config module (this one), same as Lender
// Configuration and DSA/Partner Management — configuration-module rights,
// unrelated to Loan-application visibility.
[Authorize]
public class ProductOfferMatrixController : BaseController
{
    private readonly AppDbContext _db;
    public ProductOfferMatrixController(AppDbContext db) => _db = db;

    /// <summary>All saved matrices, keyed by product. Products not present here mean "use the frontend default".</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var matrices = await _db.ProductOfferMatrices
            .Select(p => new { p.ProductKey, p.MatrixJson, p.UpdatedAt })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(matrices));
    }

    /// <summary>Create or update the matrix for one product key (upsert).</summary>
    [HttpPut("{productKey}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> Upsert(string productKey, [FromBody] ProductOfferMatrixDto dto)
    {
        if (string.IsNullOrWhiteSpace(productKey))
            return BadRequest(ApiResponseDto<object>.Fail("Product key is required."));
        if (string.IsNullOrWhiteSpace(dto.MatrixJson))
            return BadRequest(ApiResponseDto<object>.Fail("matrixJson is required."));

        var key = productKey.Trim().ToLower();
        var existing = await _db.ProductOfferMatrices.FirstOrDefaultAsync(p => p.ProductKey == key);
        if (existing == null)
        {
            existing = new ProductOfferMatrix { ProductKey = key, CreatedAt = DateTime.UtcNow };
            _db.ProductOfferMatrices.Add(existing);
        }
        existing.MatrixJson = dto.MatrixJson;
        existing.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Matrix saved."));
    }
}

public class ProductOfferMatrixDto
{
    public string MatrixJson { get; set; } = string.Empty;
}
