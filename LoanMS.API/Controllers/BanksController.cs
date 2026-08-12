using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Phase 5B — Banks: full database persistence ──────────────────────────────
// Mirrors LocationsController, the closest structural analog: same nav-role
// gating (Admin + Manager can view the page), same RBAC convention for
// mutations (destructive/write actions are Admin-only — Manager gets
// read-only access, matching how Locations is already enforced). This keeps
// RBAC consistent across the two simple "master data" screens rather than
// introducing a new pattern for Banks specifically.
// ProductTeam added to all three mutation endpoints (Create/Update/Delete) —
// per the business owner, Product Team gets full rights over Lender
// Configuration (this module), same as DSA/Partner Management and the Wizard
// Offers matrix. This is a configuration-module right, unrelated to Loan
// visibility, which ProductTeam still does not get.
[Authorize]
public class BanksController : BaseController
{
    private readonly AppDbContext _db;
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;
    public BanksController(AppDbContext db, LoanMS.API.Services.IRolePermissionService rolePerm) { _db = db; _rolePerm = rolePerm; }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        // Server-side enforcement of Menu Access Control (Settings screen)
        // — same non-invasive, fail-open pattern as LoansController's
        // action-permission checks (see RolePermissionService).
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "banks"))
            return Forbid();

        var banks = await _db.Banks
            .Include(b => b.Lines)
            .OrderBy(b => b.BankName)
            .Select(b => new
            {
                b.Id,
                b.BankName,
                b.IfscPrefix,
                b.EmpCode,
                b.Location,
                b.RmName,
                b.RmMobile,
                b.Email,
                b.Remarks,
                b.IsActive,
                b.CreatedAt,
                b.UpdatedAt,
                // ── Lender Configuration eligibility fields ──
                b.IsIncred,
                b.IsElite,
                b.MinCibil,
                b.AcceptNtc,
                b.MaxLoanAmt,
                b.MinTenure,
                b.MaxTenure,
                b.FoirLimit,
                b.PfRequired,
                b.MinAge,
                b.MaxAge,
                b.MinExpMonths,
                b.EmpTypesJson,
                b.CompTypesJson,
                b.LoanTypesJson,
                b.ServiceablePinsJson,
                b.HomeTypesJson,
                ProductRules = b.ProductRules.Select(r => new {
                    r.ProductKey, r.MinCibil, r.AcceptNtc, r.MaxLoanAmt, r.MinTenure, r.MaxTenure,
                    r.FoirLimit, r.PfRequired, r.MinAge, r.MaxAge, r.MinExpMonths,
                    r.EmpTypesJson, r.CompTypesJson, r.HomeTypesJson
                }),
                Lines = b.Lines.Select(l => new { l.Id, l.CompanyId, l.CategoryId, l.PinCode, l.Pf })
            })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(banks));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var bank = await _db.Banks.FindAsync(id);
        if (bank == null) return NotFound(ApiResponseDto<bool>.Fail("Bank not found."));
        return Ok(ApiResponseDto<BankMaster>.Ok(bank));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> Create([FromBody] BankDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.BankName))
            return BadRequest(ApiResponseDto<object>.Fail("Bank Name is required."));

        var name = dto.BankName.Trim();

        // Server-side duplicate check (case-insensitive) — the client-supplied
        // form data is never trusted for uniqueness; this is enforced here and
        // backed by the DB-level unique filtered index as a second guard.
        var exists = await _db.Banks.AnyAsync(b => b.BankName.ToLower() == name.ToLower());
        if (exists)
            return BadRequest(ApiResponseDto<object>.Fail("A bank with this name already exists."));

        var bank = new BankMaster
        {
            BankName = name,
            IfscPrefix = dto.IfscPrefix?.Trim(),
            EmpCode = dto.EmpCode?.Trim(),
            Location = dto.Location?.Trim(),
            RmName = dto.RmName?.Trim(),
            RmMobile = dto.RmMobile?.Trim(),
            Email = dto.Email?.Trim(),
            Remarks = dto.Remarks?.Trim(),
            IsActive = dto.IsActive ?? true,
            // Owner/creator is always taken from the authenticated JWT claim,
            // never from client-supplied input, per server-side identity rule.
            CreatedByUserId = CurrentUserId,
            CreatedAt = DateTime.UtcNow,
            // ── Lender Configuration eligibility fields (all optional —
            // defaults on BankMaster kick in if the caller doesn't send them,
            // matching the frontend's laConfirmAddBank() quick-add flow) ──
            IsIncred      = dto.IsIncred ?? false,
            IsElite       = dto.IsElite ?? false,
            MinCibil      = dto.MinCibil ?? 700,
            AcceptNtc     = dto.AcceptNtc ?? false,
            MaxLoanAmt    = dto.MaxLoanAmt ?? 5000000,
            MinTenure     = dto.MinTenure ?? 12,
            MaxTenure     = dto.MaxTenure ?? 60,
            FoirLimit     = dto.FoirLimit ?? 50,
            PfRequired    = dto.PfRequired ?? false,
            MinAge        = dto.MinAge ?? 21,
            MaxAge        = dto.MaxAge ?? 60,
            MinExpMonths  = dto.MinExpMonths ?? 6,
            EmpTypesJson  = dto.EmpTypes  != null ? System.Text.Json.JsonSerializer.Serialize(dto.EmpTypes)  : "[]",
            CompTypesJson = dto.CompTypes != null ? System.Text.Json.JsonSerializer.Serialize(dto.CompTypes) : "[]"
        };

        try
        {
            _db.Banks.Add(bank);
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Race-condition fallback: two concurrent requests both passed the
            // AnyAsync check above but the unique index rejected the second insert.
            return BadRequest(ApiResponseDto<object>.Fail("A bank with this name already exists."));
        }

        return Ok(ApiResponseDto<object>.Ok(new { bank.Id }, "Bank created."));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> Update(int id, [FromBody] BankDto dto)
    {
        var bank = await _db.Banks.FindAsync(id);
        if (bank == null) return NotFound(ApiResponseDto<bool>.Fail("Bank not found."));

        if (string.IsNullOrWhiteSpace(dto.BankName))
            return BadRequest(ApiResponseDto<object>.Fail("Bank Name is required."));

        var name = dto.BankName.Trim();
        var duplicate = await _db.Banks.AnyAsync(b => b.Id != id && b.BankName.ToLower() == name.ToLower());
        if (duplicate)
            return BadRequest(ApiResponseDto<object>.Fail("A bank with this name already exists."));

        bank.BankName = name;
        bank.IfscPrefix = dto.IfscPrefix?.Trim();
        bank.EmpCode = dto.EmpCode?.Trim();
        bank.Location = dto.Location?.Trim();
        bank.RmName = dto.RmName?.Trim();
        bank.RmMobile = dto.RmMobile?.Trim();
        bank.Email = dto.Email?.Trim();
        bank.Remarks = dto.Remarks?.Trim();
        if (dto.IsActive.HasValue) bank.IsActive = dto.IsActive.Value;
        // ── Lender Configuration eligibility fields — only overwritten when
        // the caller actually sent a value, same "partial update" convention
        // used by WizardController.ApplyMapping, so a plain contact-details
        // edit (RM name/mobile) from the Banks/NBFC screen can never
        // accidentally wipe out eligibility rules configured separately from
        // the Lender Configuration screen. ──
        if (dto.IsIncred.HasValue)     bank.IsIncred     = dto.IsIncred.Value;
        if (dto.IsElite.HasValue)      bank.IsElite      = dto.IsElite.Value;
        if (dto.MinCibil.HasValue)     bank.MinCibil     = dto.MinCibil.Value;
        if (dto.AcceptNtc.HasValue)    bank.AcceptNtc    = dto.AcceptNtc.Value;
        if (dto.MaxLoanAmt.HasValue)   bank.MaxLoanAmt   = dto.MaxLoanAmt.Value;
        if (dto.MinTenure.HasValue)    bank.MinTenure    = dto.MinTenure.Value;
        if (dto.MaxTenure.HasValue)    bank.MaxTenure    = dto.MaxTenure.Value;
        if (dto.FoirLimit.HasValue)    bank.FoirLimit    = dto.FoirLimit.Value;
        if (dto.PfRequired.HasValue)   bank.PfRequired   = dto.PfRequired.Value;
        if (dto.MinAge.HasValue)       bank.MinAge       = dto.MinAge.Value;
        if (dto.MaxAge.HasValue)       bank.MaxAge       = dto.MaxAge.Value;
        if (dto.MinExpMonths.HasValue) bank.MinExpMonths = dto.MinExpMonths.Value;
        if (dto.EmpTypes  != null) bank.EmpTypesJson  = System.Text.Json.JsonSerializer.Serialize(dto.EmpTypes);
        if (dto.CompTypes != null) bank.CompTypesJson = System.Text.Json.JsonSerializer.Serialize(dto.CompTypes);
        if (dto.LoanTypes != null) bank.LoanTypesJson = System.Text.Json.JsonSerializer.Serialize(dto.LoanTypes);
        if (dto.ServiceablePins != null) bank.ServiceablePinsJson = System.Text.Json.JsonSerializer.Serialize(dto.ServiceablePins);
        if (dto.HomeTypes != null) bank.HomeTypesJson = System.Text.Json.JsonSerializer.Serialize(dto.HomeTypes);
        bank.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Bank updated."));
    }

    /// <summary>
    /// Upsert per-product rule variation for a bank (Lender Configuration's
    /// per-product tabs — Bank Rules, Employment Types, Home Types).
    /// Separate from Update() above, which writes BankMaster's own flat
    /// fields (the single set the wizard's eligibility engine actually
    /// reads); this is the fuller, per-product picture.
    /// </summary>
    [HttpPut("{id:int}/product-rules/{productKey}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> UpsertProductRule(int id, string productKey, [FromBody] BankProductRuleDto dto)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();

        var bankExists = await _db.Banks.AnyAsync(b => b.Id == id);
        if (!bankExists) return NotFound(ApiResponseDto<bool>.Fail("Bank not found."));

        var rule = await _db.Set<BankProductRule>()
            .FirstOrDefaultAsync(r => r.BankId == id && r.ProductKey == productKey);

        if (rule == null)
        {
            rule = new BankProductRule { BankId = id, ProductKey = productKey, CreatedAt = DateTime.UtcNow };
            _db.Set<BankProductRule>().Add(rule);
        }
        else
        {
            rule.UpdatedAt = DateTime.UtcNow;
        }

        if (dto.MinCibil.HasValue)     rule.MinCibil     = dto.MinCibil.Value;
        if (dto.AcceptNtc.HasValue)    rule.AcceptNtc     = dto.AcceptNtc.Value;
        if (dto.MaxLoanAmt.HasValue)   rule.MaxLoanAmt    = dto.MaxLoanAmt.Value;
        if (dto.MinTenure.HasValue)    rule.MinTenure     = dto.MinTenure.Value;
        if (dto.MaxTenure.HasValue)    rule.MaxTenure     = dto.MaxTenure.Value;
        if (dto.FoirLimit.HasValue)    rule.FoirLimit     = dto.FoirLimit.Value;
        if (dto.PfRequired.HasValue)   rule.PfRequired    = dto.PfRequired.Value;
        if (dto.MinAge.HasValue)       rule.MinAge        = dto.MinAge.Value;
        if (dto.MaxAge.HasValue)       rule.MaxAge        = dto.MaxAge.Value;
        if (dto.MinExpMonths.HasValue) rule.MinExpMonths  = dto.MinExpMonths.Value;
        if (dto.EmpTypes  != null) rule.EmpTypesJson  = System.Text.Json.JsonSerializer.Serialize(dto.EmpTypes);
        if (dto.CompTypes != null) rule.CompTypesJson = System.Text.Json.JsonSerializer.Serialize(dto.CompTypes);
        if (dto.HomeTypes != null) rule.HomeTypesJson = System.Text.Json.JsonSerializer.Serialize(dto.HomeTypes);

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Product rules saved."));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> Delete(int id)
    {
        var bank = await _db.Banks.FindAsync(id);
        if (bank == null) return NotFound(ApiResponseDto<bool>.Fail("Bank not found."));

        // Soft delete only — same convention as LocationsController/DsaController.
        // No FK relationships currently reference BankMaster, so nothing downstream
        // (loans/applications/payouts/reports) can be broken by this.
        bank.IsDeleted = true;
        bank.IsActive = false;
        bank.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Bank deleted."));
    }
}

public class BankDto
{
    public string BankName { get; set; } = string.Empty;
    public string? IfscPrefix { get; set; }
    public string? EmpCode { get; set; }
    public string? Location { get; set; }
    public string? RmName { get; set; }
    public string? RmMobile { get; set; }
    public string? Email { get; set; }
    public string? Remarks { get; set; }
    public bool? IsActive { get; set; }

    // ── Lender Configuration eligibility fields (all optional — a plain
    // contact-details save from the Banks/NBFC screen won't send these) ──
    public bool? IsIncred { get; set; }
    public bool? IsElite { get; set; }
    public int? MinCibil { get; set; }
    public bool? AcceptNtc { get; set; }
    public decimal? MaxLoanAmt { get; set; }
    public int? MinTenure { get; set; }
    public int? MaxTenure { get; set; }
    public int? FoirLimit { get; set; }
    public bool? PfRequired { get; set; }
    public int? MinAge { get; set; }
    public int? MaxAge { get; set; }
    public int? MinExpMonths { get; set; }
    public List<string>? EmpTypes { get; set; }
    public List<string>? CompTypes { get; set; }
    public List<string>? LoanTypes { get; set; }
    public List<string>? ServiceablePins { get; set; }
    public List<string>? HomeTypes { get; set; }
}

public class BankProductRuleDto
{
    public int? MinCibil { get; set; }
    public bool? AcceptNtc { get; set; }
    public decimal? MaxLoanAmt { get; set; }
    public int? MinTenure { get; set; }
    public int? MaxTenure { get; set; }
    public int? FoirLimit { get; set; }
    public bool? PfRequired { get; set; }
    public int? MinAge { get; set; }
    public int? MaxAge { get; set; }
    public int? MinExpMonths { get; set; }
    public List<string>? EmpTypes { get; set; }
    public List<string>? CompTypes { get; set; }
    public List<string>? HomeTypes { get; set; }
}
