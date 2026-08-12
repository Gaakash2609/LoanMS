using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Lender Configuration — Companies / Categories / Bank Eligibility Lines ───
// Backs the "Companies", "Categories", and "Import Lines" tabs of the Lender
// Configuration screen (efin-app.js's LA_DB.companies / LA_DB.categories /
// LA_DB.banks[].lines), and the same data Wizard Step 9's laLoadEligibility()
// matches applicants against. Was entirely browser-memory-only before this —
// see BankMaster's IsIncred/MinCibil/etc fields and this controller's own
// migration (AddLenderConfigEligibilityEngine) for the full picture.
// Same RBAC convention as BanksController/DsaController: read open to any
// authenticated role (the wizard's eligibility matching needs it for every
// role that can generate a first offer), mutations Admin + ProductTeam.
[Authorize]
[Route("api/[controller]")]
public class LenderConfigController : BaseController
{
    private readonly AppDbContext _db;
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;
    public LenderConfigController(AppDbContext db, LoanMS.API.Services.IRolePermissionService rolePerm) { _db = db; _rolePerm = rolePerm; }

    // ── Companies ─────────────────────────────────────────────────────────────

    [HttpGet("companies")]
    public async Task<IActionResult> GetCompanies()
    {
        var companies = await _db.AnalyticCompanies.OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name, c.EmpTypesJson, c.CompType })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(companies));
    }

    [HttpPost("companies")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> CreateCompany([FromBody] AnalyticCompanyDto dto)
    {
        // Menu Access Control — only reachable by Admin/ProductTeam already
        // (see [Authorize] above); this only lets Admin further restrict
        // ProductTeam specifically, via the "Policy & Product" menu toggle.
        // Deliberately NOT applied to GetCompanies()/other READ endpoints in
        // this controller — the wizard's eligibility matching reads this
        // same data for every role that can start a wizard, and blocking
        // reads here would break the wizard for any role missing this menu
        // item, which is a real regression, not a permission fix.
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();

        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(ApiResponseDto<object>.Fail("Company name is required."));

        var company = new AnalyticCompany
        {
            Name = dto.Name.Trim(),
            EmpTypesJson = dto.EmpTypes != null ? System.Text.Json.JsonSerializer.Serialize(dto.EmpTypes) : "[]",
            CompType = dto.CompType,
            CreatedAt = DateTime.UtcNow
        };
        _db.AnalyticCompanies.Add(company);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { company.Id }, "Company added."));
    }

    [HttpPut("companies/{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> UpdateCompany(int id, [FromBody] AnalyticCompanyDto dto)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();

        var company = await _db.AnalyticCompanies.FindAsync(id);
        if (company == null) return NotFound(ApiResponseDto<bool>.Fail("Company not found."));
        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(ApiResponseDto<object>.Fail("Company name is required."));

        company.Name = dto.Name.Trim();
        if (dto.EmpTypes != null) company.EmpTypesJson = System.Text.Json.JsonSerializer.Serialize(dto.EmpTypes);
        if (dto.CompType != null) company.CompType = dto.CompType;
        company.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Company updated."));
    }

    [HttpDelete("companies/{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> DeleteCompany(int id)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();

        var company = await _db.AnalyticCompanies.FindAsync(id);
        if (company == null) return NotFound(ApiResponseDto<bool>.Fail("Company not found."));
        company.IsDeleted = true;
        company.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Company deleted."));
    }

    // ── Categories ────────────────────────────────────────────────────────────

    [HttpGet("categories")]
    public async Task<IActionResult> GetCategories()
    {
        var categories = await _db.AnalyticCategories.OrderBy(c => c.Salary)
            .Select(c => new { c.Id, c.Name, c.Salary })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(categories));
    }

    [HttpPost("categories")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> CreateCategory([FromBody] AnalyticCategoryDto dto)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();

        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(ApiResponseDto<object>.Fail("Category name is required."));

        var category = new AnalyticCategory
        {
            Name = dto.Name.Trim(),
            Salary = dto.Salary,
            CreatedAt = DateTime.UtcNow
        };
        _db.AnalyticCategories.Add(category);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { category.Id }, "Category added."));
    }

    [HttpPut("categories/{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> UpdateCategory(int id, [FromBody] AnalyticCategoryDto dto)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();

        var category = await _db.AnalyticCategories.FindAsync(id);
        if (category == null) return NotFound(ApiResponseDto<bool>.Fail("Category not found."));
        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(ApiResponseDto<object>.Fail("Category name is required."));

        category.Name = dto.Name.Trim();
        category.Salary = dto.Salary;
        category.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Category updated."));
    }

    [HttpDelete("categories/{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> DeleteCategory(int id)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();

        var category = await _db.AnalyticCategories.FindAsync(id);
        if (category == null) return NotFound(ApiResponseDto<bool>.Fail("Category not found."));
        category.IsDeleted = true;
        category.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Category deleted."));
    }

    // ── Bank Eligibility Lines ────────────────────────────────────────────────
    // A "line" pairs a Company + Category (+ optional PIN/PF) under a
    // specific Bank — this is what makes that bank "Path A — Company List"
    // for the applicant-matching engine (see BanksController.GetAll, which
    // already includes each bank's Lines).

    [HttpPost("lines")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> CreateLine([FromBody] BankEligibilityLineDto dto)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();

        var bankExists = await _db.Banks.AnyAsync(b => b.Id == dto.BankId);
        if (!bankExists) return BadRequest(ApiResponseDto<object>.Fail("Bank not found."));
        var companyExists = await _db.AnalyticCompanies.AnyAsync(c => c.Id == dto.CompanyId);
        if (!companyExists) return BadRequest(ApiResponseDto<object>.Fail("Company not found."));
        var categoryExists = await _db.AnalyticCategories.AnyAsync(c => c.Id == dto.CategoryId);
        if (!categoryExists) return BadRequest(ApiResponseDto<object>.Fail("Category not found."));

        var line = new BankEligibilityLine
        {
            BankId = dto.BankId,
            CompanyId = dto.CompanyId,
            CategoryId = dto.CategoryId,
            PinCode = dto.PinCode?.Trim(),
            Pf = dto.Pf,
            CreatedAt = DateTime.UtcNow
        };
        _db.BankEligibilityLines.Add(line);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { line.Id }, "Line added."));
    }

    [HttpDelete("lines/{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> DeleteLine(int id)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();

        var line = await _db.BankEligibilityLines.FindAsync(id);
        if (line == null) return NotFound(ApiResponseDto<bool>.Fail("Line not found."));
        line.IsDeleted = true;
        line.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Line deleted."));
    }

    // ── Lender Matching Engine (🔴 CRITICAL — production-ready matching) ───────
    // Server-side port of the exact same 11-check eligibility logic that
    // previously only existed client-side (efin-app.js's laLoadEligibility()).
    // This IS the authoritative matching engine now — Wizard Step 9 and the
    // live-eligibility-preview (see WizardController) both call this same
    // endpoint, so there is exactly one matching algorithm, not two.
    //
    // NOTE on "serviceablePins": the original JS referenced a bank-level
    // `bank.serviceablePins` list that has no equivalent column in
    // BankMaster or anywhere else in the current schema — only each
    // individual BankEligibilityLine has its own PinCode. Rather than invent
    // a new column for something not represented in the existing data
    // model, this derives a bank's serviceable PIN set as the distinct
    // PinCodes across its own Lines (empty ⇒ no PIN restriction, matching
    // the original "no serviceablePins configured ⇒ unrestricted" behavior).
    // This is a best-effort interpretation, not a business-confirmed rule —
    // flagged in the final report.
    [HttpPost("match")]
    public async Task<IActionResult> Match([FromBody] LenderMatchRequestDto req)
    {
        var results = new List<LenderMatchResultDto>();

        // Salary is the only hard prerequisite before evaluation can begin —
        // same rule as the original: an applicant with no salary yet can't
        // be scored against any bank (Company is an optional per-bank filter,
        // decided inside the loop, never a global blocker).
        if (req.Salary <= 0)
            return Ok(ApiResponseDto<object>.Ok(new { awaitingDetails = true, eligible = new List<object>(), disqualified = new List<object>() }));

        var banks = await _db.Banks
            .Where(b => b.IsActive && !b.IsDeleted)
            .Include(b => b.Lines)
            .ToListAsync();
        var categories = await _db.AnalyticCategories.ToListAsync();

        var loanType = string.IsNullOrWhiteSpace(req.LoanType) ? "personal_loan" : req.LoanType;
        var empType  = string.IsNullOrWhiteSpace(req.EmpType) ? "SALARIED" : req.EmpType.ToUpperInvariant();
        var compType = (req.CompType ?? "").ToLowerInvariant();
        var foir     = req.Salary > 0 && req.Obligations.HasValue
            ? (int)Math.Round(req.Obligations.Value / req.Salary * 100)
            : 0;

        foreach (var bank in banks)
        {
            var reasons = new List<string>();
            List<string> empTypes  = SafeDeserializeStringList(bank.EmpTypesJson);
            List<string> compTypes = SafeDeserializeStringList(bank.CompTypesJson);

            // 2. Two-path company / salary matching (Path A vs Path B — see
            // class doc comment on BankEligibilityLine for the concept).
            var bankHasCompanyList = bank.Lines.Any();
            bool lineMatch = false;
            AnalyticCategory? matchedCat = null;
            BankEligibilityLine? matchedLine = null;

            if (bankHasCompanyList)
            {
                if (req.CompanyId.HasValue)
                {
                    foreach (var line in bank.Lines)
                    {
                        if (line.CompanyId != req.CompanyId.Value) continue;
                        var cat = categories.FirstOrDefault(c => c.Id == line.CategoryId);
                        if (cat != null && cat.Salary <= req.Salary)
                        {
                            lineMatch = true; matchedCat = cat; matchedLine = line; break;
                        }
                    }
                }
                if (!lineMatch)
                {
                    results.Add(new LenderMatchResultDto
                    {
                        BankId = bank.Id, BankName = bank.BankName, Eligible = false,
                        Reason = req.CompanyId.HasValue
                            ? "Company not in this bank's approved list"
                            : "No employer selected — bank requires an approved company"
                    });
                    continue;
                }
            }
            else
            {
                AnalyticCategory? bestCat = null;
                foreach (var cat in categories)
                {
                    if (cat.Salary <= req.Salary && (bestCat == null || cat.Salary > bestCat.Salary))
                        bestCat = cat;
                }
                if (bestCat != null) { lineMatch = true; matchedCat = bestCat; }
                else
                {
                    results.Add(new LenderMatchResultDto
                    {
                        BankId = bank.Id, BankName = bank.BankName, Eligible = false,
                        Reason = $"Salary ₹{req.Salary:N0} below all category thresholds"
                    });
                    continue;
                }
            }

            // 3. PF requirement (Path A only — matchedLine is null on Path B)
            if (matchedLine != null && bank.PfRequired)
            {
                var likelyPf = empType == "SALARIED" && new[] { "plcc", "plc", "govt", "psu" }.Contains(compType);
                if (!likelyPf && matchedLine.Pf) reasons.Add("PF required by this bank");
            }

            // 4. PIN code — derived serviceable-PIN set (see class doc comment above)
            var bankPins = bank.Lines.Where(l => !string.IsNullOrWhiteSpace(l.PinCode)).Select(l => l.PinCode).Distinct().ToList();
            if (bankPins.Count > 0 && !string.IsNullOrWhiteSpace(req.PinCode) && !bankPins.Contains(req.PinCode))
                reasons.Add($"PIN {req.PinCode} not serviceable");

            // 5. CIBIL
            if (bank.MinCibil > 0 && req.Cibil.HasValue && req.Cibil.Value > 0 && req.Cibil.Value < bank.MinCibil)
                reasons.Add($"CIBIL {req.Cibil.Value} < min {bank.MinCibil}");

            // 6. Employment type
            if (empTypes.Count > 0 && !empTypes.Contains(empType))
                reasons.Add($"Employment type {empType} not accepted");

            // 7. Company type
            if (compTypes.Count > 0 && !string.IsNullOrWhiteSpace(compType) && !compTypes.Contains(compType))
                reasons.Add($"Company type {compType} not preferred");

            // 8. Max loan amount
            if (bank.MaxLoanAmt > 0 && req.LoanAmount.HasValue && req.LoanAmount.Value > bank.MaxLoanAmt)
                reasons.Add($"Loan ₹{req.LoanAmount.Value:N0} > max ₹{bank.MaxLoanAmt:N0}");

            // 9. Tenure
            if (req.Tenure.HasValue && req.Tenure.Value > 0)
            {
                if (bank.MinTenure > 0 && req.Tenure.Value < bank.MinTenure) reasons.Add($"Tenure {req.Tenure.Value}mo < min {bank.MinTenure}mo");
                if (bank.MaxTenure > 0 && req.Tenure.Value > bank.MaxTenure) reasons.Add($"Tenure {req.Tenure.Value}mo > max {bank.MaxTenure}mo");
            }

            // 10. FOIR
            if (bank.FoirLimit > 0 && foir > 0 && foir > bank.FoirLimit)
                reasons.Add($"FOIR {foir}% > limit {bank.FoirLimit}%");

            // 11. Age
            if (req.Age.HasValue && req.Age.Value > 0)
            {
                if (bank.MinAge > 0 && req.Age.Value < bank.MinAge) reasons.Add($"Age {req.Age.Value} < min {bank.MinAge}");
                if (bank.MaxAge > 0 && req.Age.Value > bank.MaxAge) reasons.Add($"Age {req.Age.Value} > max {bank.MaxAge}");
            }

            if (reasons.Count > 0)
            {
                results.Add(new LenderMatchResultDto { BankId = bank.Id, BankName = bank.BankName, Eligible = false, Reason = string.Join(" · ", reasons) });
            }
            else
            {
                double score = 0;
                if (matchedCat != null && req.Salary > 0) score += Math.Min((double)matchedCat.Salary / (double)req.Salary * 30, 30);
                if (bank.MinCibil > 0) score += Math.Max(0, 30 - (bank.MinCibil - 650) / 10.0);
                if (bank.MaxLoanAmt > 0) score += Math.Min((double)bank.MaxLoanAmt / 1000000 * 5, 20);
                if (bank.FoirLimit > 0) score += bank.FoirLimit >= foir + 10 ? 10 : 0;
                results.Add(new LenderMatchResultDto { BankId = bank.Id, BankName = bank.BankName, Eligible = true, Score = Math.Round(score, 1) });
            }
        }

        var eligibleCount = results.Count(r => r.Eligible);
        return Ok(ApiResponseDto<object>.Ok(new
        {
            awaitingDetails = false,
            totalBanksConfigured = banks.Count,
            eligibleCount,
            results = results.OrderByDescending(r => r.Eligible).ThenByDescending(r => r.Score).ToList()
        }));
    }

    private static List<string> SafeDeserializeStringList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<string>();
        try { return System.Text.Json.JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>(); }
        catch { return new List<string>(); }
    }
}

public class AnalyticCompanyDto
{
    public string Name { get; set; } = string.Empty;
    public List<string>? EmpTypes { get; set; }
    public string? CompType { get; set; }
}

public class LenderMatchRequestDto
{    public string? LoanType { get; set; }
    public decimal Salary { get; set; }
    public decimal? Obligations { get; set; }
    public string? EmpType { get; set; }
    public string? CompType { get; set; }
    public int? CompanyId { get; set; }
    public int? Cibil { get; set; }
    public decimal? LoanAmount { get; set; }
    public int? Tenure { get; set; }
    public string? PinCode { get; set; }
    public int? Age { get; set; }
}

public class LenderMatchResultDto
{
    public int BankId { get; set; }
    public string BankName { get; set; } = string.Empty;
    public bool Eligible { get; set; }
    public string? Reason { get; set; }
    public double Score { get; set; }
}

public class AnalyticCategoryDto
{
    public string Name { get; set; } = string.Empty;
    public decimal Salary { get; set; }
}

public class BankEligibilityLineDto
{
    public int BankId { get; set; }
    public int CompanyId { get; set; }
    public int CategoryId { get; set; }
    public string? PinCode { get; set; }
    public bool Pf { get; set; }
}
