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

    // ── Per-product Income/Turnover Categories ──────────────────────────────────
    // Non-personal multi-config "Categories" tab (efin-app.js lcBlRenderCategories
    // / LA_DB.productCategories[productKey]). Keyed by (ProductKey, BankId) — a
    // turnover tier per bank per product. Distinct from AnalyticCategories above.

    [HttpGet("product-categories/{productKey}")]
    public async Task<IActionResult> GetProductCategories(string productKey)
    {
        var cats = await _db.BankProductCategories
            .Where(c => c.ProductKey == productKey)
            .OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.BankId, c.ProductKey, c.Name, c.MinTurnover, c.Color, c.Notes })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(cats));
    }

    [HttpPost("product-categories")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> CreateProductCategory([FromBody] BankProductCategoryDto dto)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();
        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(ApiResponseDto<object>.Fail("Category name is required."));
        if (string.IsNullOrWhiteSpace(dto.ProductKey))
            return BadRequest(ApiResponseDto<object>.Fail("Product key is required."));
        if (!await _db.Banks.AnyAsync(b => b.Id == dto.BankId))
            return BadRequest(ApiResponseDto<object>.Fail("Bank not found."));

        var cat = new BankProductCategory
        {
            BankId = dto.BankId,
            ProductKey = dto.ProductKey.Trim(),
            Name = dto.Name.Trim(),
            MinTurnover = dto.MinTurnover,
            Color = string.IsNullOrWhiteSpace(dto.Color) ? "standard" : dto.Color.Trim(),
            Notes = dto.Notes?.Trim(),
            CreatedAt = DateTime.UtcNow
        };
        _db.BankProductCategories.Add(cat);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { cat.Id }, "Category added."));
    }

    [HttpPut("product-categories/{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> UpdateProductCategory(int id, [FromBody] BankProductCategoryDto dto)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();
        var cat = await _db.BankProductCategories.FindAsync(id);
        if (cat == null) return NotFound(ApiResponseDto<bool>.Fail("Category not found."));
        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(ApiResponseDto<object>.Fail("Category name is required."));

        if (dto.BankId > 0) cat.BankId = dto.BankId;
        cat.Name = dto.Name.Trim();
        cat.MinTurnover = dto.MinTurnover;
        if (!string.IsNullOrWhiteSpace(dto.Color)) cat.Color = dto.Color.Trim();
        cat.Notes = dto.Notes?.Trim();
        cat.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Category updated."));
    }

    [HttpDelete("product-categories/{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> DeleteProductCategory(int id)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "policy-product"))
            return Forbid();
        var cat = await _db.BankProductCategories.FindAsync(id);
        if (cat == null) return NotFound(ApiResponseDto<bool>.Fail("Category not found."));
        cat.IsDeleted = true;
        cat.UpdatedAt = DateTime.UtcNow;
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
            // PHASE 5 FIX: ProductRules were never loaded, so every per-product
            // override configured on the Lender Configuration screen (Max Loan,
            // CIBIL, tenure, FOIR, age, employment/company types) was silently
            // ignored by this engine — the single consumer of that config.
            .Include(b => b.ProductRules)
            .ToListAsync();
        var categories = await _db.AnalyticCategories.ToListAsync();

        var loanType = string.IsNullOrWhiteSpace(req.LoanType) ? "personal_loan" : req.LoanType;
        // Canonical product key for the requested loan type — the request may
        // arrive as a React key ('personal', 'newcar'), a wizard key
        // ('personal_loan', 'new_car'), a legacy key ('loan_against_property')
        // or the enum name ('Personal', 'AgainstProperty'); all normalise to
        // the same canonical form so the per-bank product filter below matches
        // regardless of caller. (See NormalizeLoanType.)
        var reqLoanType = NormalizeLoanType(loanType);
        var empType  = string.IsNullOrWhiteSpace(req.EmpType) ? "SALARIED" : req.EmpType.ToUpperInvariant();
        var compType = (req.CompType ?? "").ToLowerInvariant();
        var foir     = req.Salary > 0 && req.Obligations.HasValue
            ? (int)Math.Round(req.Obligations.Value / req.Salary * 100)
            : 0;

        foreach (var bank in banks)
        {
            // 1. Product assignment filter (legacy laLoadEligibility:16654) —
            //    a bank with a non-empty LoanTypesJson only offers those
            //    products; an empty/absent list means "all products" and is
            //    NEVER filtered (so existing banks that were never assigned
            //    keep showing everywhere, exactly like Vanilla's null case).
            var bankLoanTypes = SafeDeserializeStringList(bank.LoanTypesJson);
            if (bankLoanTypes.Count > 0 && !string.IsNullOrEmpty(reqLoanType) &&
                !bankLoanTypes.Any(x => NormalizeLoanType(x) == reqLoanType))
            {
                results.Add(new LenderMatchResultDto
                {
                    BankId = bank.Id, BankName = bank.BankName, Eligible = false,
                    Reason = $"Not offered for {loanType}"
                });
                continue;
            }

            var reasons = new List<string>();

            // ── Effective rule resolution (PHASE 5 FIX) ──────────────────────
            // Personal Loan stores its rules on the BankMaster row itself; the
            // other 8 products store them in BankProductRule keyed by
            // ProductKey. That split is the data model the Lender Configuration
            // UI already writes to (BanksController.UpsertProductRule), but this
            // engine only ever read the base columns — so a Business Loan was
            // scored against the bank's PERSONAL loan limits.
            //
            // Fallback is per-field, not per-row: a product rule that only sets
            // MaxLoanAmt still inherits CIBIL/tenure/age from the bank, matching
            // the UI, where a blank per-product field means "no override".
            var rule = bank.ProductRules
                .FirstOrDefault(r => NormalizeLoanType(r.ProductKey) == reqLoanType);

            var effMinCibil     = rule?.MinCibil     ?? bank.MinCibil;
            var effMaxLoanAmt   = rule?.MaxLoanAmt   ?? bank.MaxLoanAmt;
            var effMinTenure    = rule?.MinTenure    ?? bank.MinTenure;
            var effMaxTenure    = rule?.MaxTenure    ?? bank.MaxTenure;
            var effFoirLimit    = rule?.FoirLimit    ?? bank.FoirLimit;
            // PfRequired is a non-nullable bool on BankProductRule, so a rule row
            // created to override some OTHER field carries PfRequired=false and
            // is indistinguishable from a deliberate "false". OR-ing means a
            // product rule can ADD a PF requirement but an incidental default
            // can never silently drop the bank's own one. Behaviour is unchanged
            // for banks with no product rule at all.
            var effPfRequired   = bank.PfRequired || (rule?.PfRequired ?? false);
            var effMinAge       = rule?.MinAge       ?? bank.MinAge;
            var effMaxAge       = rule?.MaxAge       ?? bank.MaxAge;

            // List overrides apply only when the product actually defines a
            // non-empty list — an empty per-product list means "not configured"
            // (inherit), never "accept nothing", which would wrongly reject
            // every applicant the moment any other field was overridden.
            var ruleEmpTypes  = SafeDeserializeStringList(rule?.EmpTypesJson);
            var ruleCompTypes = SafeDeserializeStringList(rule?.CompTypesJson);
            List<string> empTypes  = ruleEmpTypes.Count  > 0 ? ruleEmpTypes  : SafeDeserializeStringList(bank.EmpTypesJson);
            List<string> compTypes = ruleCompTypes.Count > 0 ? ruleCompTypes : SafeDeserializeStringList(bank.CompTypesJson);

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
            if (matchedLine != null && effPfRequired)
            {
                var likelyPf = empType == "SALARIED" && new[] { "plcc", "plc", "govt", "psu" }.Contains(compType);
                if (!likelyPf && matchedLine.Pf) reasons.Add("PF required by this bank");
            }

            // 4. PIN code — PHASE 5 FIX: BankMaster.ServiceablePinsJson now
            // exists (added after this method was written; the doc comment above
            // predates it) and is what the Lender Configuration PIN Codes grid
            // actually writes to. Prefer it; fall back to the PINs derived from
            // the bank's own eligibility Lines only when no bank-level list has
            // been configured, so existing Path-A banks keep their behaviour.
            var configuredPins = SafeDeserializeStringList(bank.ServiceablePinsJson)
                .Select(p => p.Trim()).Where(p => !string.IsNullOrWhiteSpace(p)).Distinct().ToList();
            var bankPins = configuredPins.Count > 0
                ? configuredPins
                : bank.Lines.Where(l => !string.IsNullOrWhiteSpace(l.PinCode)).Select(l => l.PinCode!).Distinct().ToList();
            if (bankPins.Count > 0 && !string.IsNullOrWhiteSpace(req.PinCode) && !bankPins.Contains(req.PinCode))
                reasons.Add($"PIN {req.PinCode} not serviceable");

            // 5. CIBIL
            if (effMinCibil > 0 && req.Cibil.HasValue && req.Cibil.Value > 0 && req.Cibil.Value < effMinCibil)
                reasons.Add($"CIBIL {req.Cibil.Value} < min {effMinCibil}");

            // 6. Employment type
            if (empTypes.Count > 0 && !empTypes.Contains(empType))
                reasons.Add($"Employment type {empType} not accepted");

            // 7. Company type — case-insensitive: the request compType is
            // lower-cased above but bank CompTypesJson stores the original
            // casing ("Pvt Ltd"), so a plain Contains never matched.
            if (compTypes.Count > 0 && !string.IsNullOrWhiteSpace(compType) &&
                !compTypes.Any(c => string.Equals(c, compType, StringComparison.OrdinalIgnoreCase)))
                reasons.Add($"Company type {compType} not preferred");

            // 8. Max loan amount
            if (effMaxLoanAmt > 0 && req.LoanAmount.HasValue && req.LoanAmount.Value > effMaxLoanAmt)
                reasons.Add($"Loan ₹{req.LoanAmount.Value:N0} > max ₹{effMaxLoanAmt:N0}");

            // 9. Tenure
            if (req.Tenure.HasValue && req.Tenure.Value > 0)
            {
                if (effMinTenure > 0 && req.Tenure.Value < effMinTenure) reasons.Add($"Tenure {req.Tenure.Value}mo < min {effMinTenure}mo");
                if (effMaxTenure > 0 && req.Tenure.Value > effMaxTenure) reasons.Add($"Tenure {req.Tenure.Value}mo > max {effMaxTenure}mo");
            }

            // 10. FOIR
            if (effFoirLimit > 0 && foir > 0 && foir > effFoirLimit)
                reasons.Add($"FOIR {foir}% > limit {effFoirLimit}%");

            // 11. Age
            if (req.Age.HasValue && req.Age.Value > 0)
            {
                if (effMinAge > 0 && req.Age.Value < effMinAge) reasons.Add($"Age {req.Age.Value} < min {effMinAge}");
                if (effMaxAge > 0 && req.Age.Value > effMaxAge) reasons.Add($"Age {req.Age.Value} > max {effMaxAge}");
            }

            if (reasons.Count > 0)
            {
                results.Add(new LenderMatchResultDto { BankId = bank.Id, BankName = bank.BankName, Eligible = false, Reason = string.Join(" · ", reasons) });
            }
            else
            {
                double score = 0;
                if (matchedCat != null && req.Salary > 0) score += Math.Min((double)matchedCat.Salary / (double)req.Salary * 30, 30);
                if (effMinCibil > 0) score += Math.Max(0, 30 - (effMinCibil - 650) / 10.0);
                if (effMaxLoanAmt > 0) score += Math.Min((double)effMaxLoanAmt / 1000000 * 5, 20);
                if (effFoirLimit > 0) score += effFoirLimit >= foir + 10 ? 10 : 0;
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

    internal static List<string> SafeDeserializeStringList(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new List<string>();
        try { return System.Text.Json.JsonSerializer.Deserialize<List<string>>(json) ?? new List<string>(); }
        catch { return new List<string>(); }
    }

    // Canonicalise a loan-type token from any caller so per-bank product
    // assignment matches regardless of key scheme: React LOAN_PRODUCTS keys
    // ('personal','newcar','lap'…), wizard keys ('personal_loan','new_car'…),
    // legacy keys ('loan_against_property','over_draft'…) and the LoanType
    // enum ('Personal','NewCar','AgainstProperty'). Lower-case, strip
    // non-alphanumerics, drop a trailing "loan", then alias the LAP variants.
    // Must mirror the frontend normalizeLoanType (banksApi.ts).
    internal static string NormalizeLoanType(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return "";
        var x = new string(s.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (x.Length > 4 && x.EndsWith("loan")) x = x.Substring(0, x.Length - 4);
        if (x == "loanagainstproperty" || x == "againstproperty") return "lap";
        return x;
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

public class BankProductCategoryDto
{
    public int BankId { get; set; }
    public string ProductKey { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public decimal MinTurnover { get; set; }
    public string? Color { get; set; }
    public string? Notes { get; set; }
}

public class BankEligibilityLineDto
{
    public int BankId { get; set; }
    public int CompanyId { get; set; }
    public int CategoryId { get; set; }
    public string? PinCode { get; set; }
    public bool Pf { get; set; }
}
