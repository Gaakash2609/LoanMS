using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;

namespace LoanMS.API.Controllers;

[Authorize]
public class LoansController : BaseController
{
    private readonly ILoanService _loanService;
    // Documents stored OUTSIDE wwwroot — never served as static files
    private static readonly string _uploadRoot =
        Path.Combine(AppContext.BaseDirectory, "secure_uploads", "loans");

    public LoansController(ILoanService loanService) => _loanService = loanService;

    /// <summary>Get dashboard statistics</summary>
    [HttpGet("dashboard")]
    public async Task<IActionResult> GetDashboard()
    {
        var result = await _loanService.GetDashboardStatsAsync(CurrentUserId, CurrentUserRole);
        return Ok(result);
    }

    /// <summary>Get all loans (paged, filtered)</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] LoanFilterDto filter)
    {
        if (filter.Page < 1) filter.Page = 1;
        if (filter.PageSize is < 1 or > 100) filter.PageSize = 10;

        var result = await _loanService.GetAllAsync(filter, CurrentUserId, CurrentUserRole);
        return Ok(result);
    }

    /// <summary>Get loan by ID</summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var result = await _loanService.GetByIdAsync(id, CurrentUserRole);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    /// <summary>Create new loan application</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateLoanRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _loanService.CreateAsync(request, CurrentUserId);
        if (!result.Success) return BadRequest(result);
        return CreatedAtAction(nameof(GetById), new { id = result.Data!.Id }, result);
    }

    /// <summary>Update loan details (Draft/Submitted only)</summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateLoanRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _loanService.UpdateAsync(id, request);
        return ApiResult(result);
    }

    /// <summary>Update loan status [Manager/Admin only]</summary>
    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> UpdateStatus(int id, [FromBody] UpdateLoanStatusRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _loanService.UpdateStatusAsync(id, request, CurrentUserId);
        return ApiResult(result);
    }

    /// <summary>Submit loan (Draft → Submitted)</summary>
    [HttpPatch("{id:int}/submit")]
    public async Task<IActionResult> Submit(int id)
    {
        var result = await _loanService.UpdateStatusAsync(id,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Submitted, Comment = "Submitted for review." },
            CurrentUserId);
        return ApiResult(result);
    }

    /// <summary>Approve loan [Manager/Admin only]</summary>
    [HttpPatch("{id:int}/approve")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Approve(int id, [FromBody] ApproveRequestDto request)
    {
        var result = await _loanService.UpdateStatusAsync(id,
            new UpdateLoanStatusRequestDto
            {
                NewStatus      = LoanStatus.Approved,
                ApprovedAmount = request.ApprovedAmount,
                Comment        = request.Comment ?? "Loan approved."
            },
            CurrentUserId);
        return ApiResult(result);
    }

    /// <summary>Reject loan [Manager/Admin only]</summary>
    [HttpPatch("{id:int}/reject")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Reject(int id, [FromBody] RejectRequestDto request)
    {
        var result = await _loanService.UpdateStatusAsync(id,
            new UpdateLoanStatusRequestDto
            {
                NewStatus = LoanStatus.Rejected,
                Comment   = request.Reason ?? "Loan rejected."
            },
            CurrentUserId);
        return ApiResult(result);
    }

    /// <summary>Disburse loan [Admin only]</summary>
    [HttpPatch("{id:int}/disburse")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Disburse(int id)
    {
        var result = await _loanService.UpdateStatusAsync(id,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Disbursed, Comment = "Loan disbursed." },
            CurrentUserId);
        return ApiResult(result);
    }

    /// <summary>Delete loan (Draft only) [Admin only]</summary>
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var result = await _loanService.DeleteAsync(id);
        return ApiResult(result);
    }

    /// <summary>
    /// Bulk fetch — same role-based scoping as GetAll.
    /// Page size capped lower for non-admin roles.
    /// </summary>
    [HttpGet("bulk")]
    public async Task<IActionResult> GetBulk([FromQuery] int pageSize = 50)
    {
        // Cap page size based on role — external roles get fewer records per call
        var maxSize = CurrentUserRole is "Admin" or "Manager" ? 200 : 50;
        pageSize = Math.Clamp(pageSize, 1, maxSize);

        var filter = new LoanFilterDto { PageSize = pageSize, Page = 1, SortBy = "CreatedAt", SortDir = "desc" };
        // Role-based scoping is applied inside GetAllAsync (same as the standard list endpoint)
        var result = await _loanService.GetAllAsync(filter, CurrentUserId, CurrentUserRole);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    /// <summary>Calculate EMI before submission — no DB write</summary>
    [HttpGet("calculate-emi")]
    public IActionResult CalculateEmi([FromQuery] decimal amount, [FromQuery] decimal rate, [FromQuery] int tenure)
    {
        if (amount <= 0 || rate <= 0 || tenure <= 0)
            return BadRequest(ApiResponseDto<object>.Fail("Invalid parameters."));

        decimal r   = rate / 12 / 100;
        decimal emi = amount * r * (decimal)Math.Pow((double)(1 + r), tenure)
                      / ((decimal)Math.Pow((double)(1 + r), tenure) - 1);
        decimal totalPayable  = Math.Round(emi, 2) * tenure;
        decimal totalInterest = totalPayable - amount;

        return Ok(ApiResponseDto<object>.Ok(new {
            monthlyEmi    = Math.Round(emi, 2),
            totalPayable  = Math.Round(totalPayable, 2),
            totalInterest = Math.Round(totalInterest, 2),
            principal     = amount,
            ratePercent   = rate,
            tenureMonths  = tenure
        }));
    }

    /// <summary>
    /// Upload document for a loan.
    /// Files are stored outside wwwroot and served only through this authenticated endpoint.
    /// </summary>
    [HttpPost("{id:int}/documents")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<IActionResult> UploadDocument(int id, IFormFile file, [FromForm] string? documentType)
    {
        var loan = await _loanService.GetByIdAsync(id, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);
        if (file == null || file.Length == 0)
            return BadRequest(ApiResponseDto<object>.Fail("No file provided."));

        if (string.IsNullOrWhiteSpace(documentType))
            return BadRequest(ApiResponseDto<object>.Fail("Document type is required."));

        // Materialise into a non-nullable local — compiler flow analysis does not narrow
        // string? to string across IsNullOrWhiteSpace, so we do it explicitly here.
        var docType = documentType.ToLowerInvariant();

        // Validate extension
        var allowedExts = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".csv" };
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExts.Contains(ext))
            return BadRequest(ApiResponseDto<object>.Fail($"File type '{ext}' is not allowed."));

        // Validate actual MIME type via magic bytes — prevent extension spoofing
        if (!await IsAllowedMimeTypeAsync(file, ext))
            return BadRequest(ApiResponseDto<object>.Fail("File content does not match its extension."));

        // Validate documentType against whitelist
        var allowedDocTypes = new[] {
            "identity", "address", "income", "bank_statement",
            "salary_slip", "itr", "gst", "property", "other"
        };
        if (!allowedDocTypes.Contains(docType))
            return BadRequest(ApiResponseDto<object>.Fail("Invalid document type."));

        // Store OUTSIDE wwwroot
        var uploadDir = Path.Combine(_uploadRoot, id.ToString());
        Directory.CreateDirectory(uploadDir);
        var fileName = $"{Guid.NewGuid()}{ext}";
        var filePath = Path.Combine(uploadDir, fileName);

        await using (var stream = new FileStream(filePath, FileMode.Create))
            await file.CopyToAsync(stream);

        // Return a reference token — not a raw file path
        return Ok(ApiResponseDto<object>.Ok(new {
            documentName  = Path.GetFileNameWithoutExtension(file.FileName),
            documentType  = docType,
            fileRef       = $"{id}/{fileName}",       // opaque ref — no /uploads/ path
            fileSizeBytes = file.Length,
            uploadedAt    = DateTime.UtcNow
        }, "Document uploaded successfully."));
    }

    /// <summary>
    /// Download a document — authenticated, ownership-checked.
    /// Replaces the old static-file URL pattern.
    /// </summary>
    [HttpGet("{id:int}/documents/{fileName}")]
    public async Task<IActionResult> DownloadDocument(int id, string fileName)
    {
        // Sanitise filename — reject path traversal attempts
        if (fileName.Contains("..") || fileName.Contains('/') || fileName.Contains('\\'))
            return BadRequest(ApiResponseDto<object>.Fail("Invalid file reference."));

        // Verify caller has access to this loan
        var loan = await _loanService.GetByIdAsync(id, CurrentUserRole);
        if (!loan.Success) return NotFound(ApiResponseDto<object>.Fail("Loan not found."));

        var filePath = Path.Combine(_uploadRoot, id.ToString(), fileName);
        if (!System.IO.File.Exists(filePath))
            return NotFound(ApiResponseDto<object>.Fail("Document not found."));

        // Serve with correct Content-Type
        var provider = new FileExtensionContentTypeProvider();
        if (!provider.TryGetContentType(fileName, out var contentType))
            contentType = "application/octet-stream";

        var bytes = await System.IO.File.ReadAllBytesAsync(filePath);
        return File(bytes, contentType, fileName);
    }

    /// <summary>List document references for a loan (no raw paths).</summary>
    [HttpGet("{id:int}/documents")]
    public async Task<IActionResult> GetDocuments(int id)
    {
        var loan = await _loanService.GetByIdAsync(id, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var uploadDir = Path.Combine(_uploadRoot, id.ToString());
        if (!Directory.Exists(uploadDir))
            return Ok(ApiResponseDto<object>.Ok(new List<object>()));

        var files = Directory.GetFiles(uploadDir)
            .Select(f => new {
                fileName  = Path.GetFileName(f),
                fileRef   = $"{id}/{Path.GetFileName(f)}",
                sizeBytes = new FileInfo(f).Length,
                uploadedAt = new FileInfo(f).CreationTime
            }).ToList();

        return Ok(ApiResponseDto<object>.Ok(files));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Validate file magic bytes against allowed extensions.</summary>
    private static async Task<bool> IsAllowedMimeTypeAsync(IFormFile file, string ext)
    {
        var headerBytes = new byte[8];
        await using var stream = file.OpenReadStream();
        var read = await stream.ReadAsync(headerBytes.AsMemory(0, 8));
        if (read < 4) return false;

        return ext switch
        {
            ".pdf"  => headerBytes[0] == 0x25 && headerBytes[1] == 0x50 &&
                       headerBytes[2] == 0x44 && headerBytes[3] == 0x46, // %PDF
            ".jpg"  => headerBytes[0] == 0xFF && headerBytes[1] == 0xD8, // JFIF/EXIF
            ".jpeg" => headerBytes[0] == 0xFF && headerBytes[1] == 0xD8,
            ".png"  => headerBytes[0] == 0x89 && headerBytes[1] == 0x50 &&
                       headerBytes[2] == 0x4E && headerBytes[3] == 0x47, // PNG
            ".xlsx" => headerBytes[0] == 0x50 && headerBytes[1] == 0x4B, // PK (ZIP)
            ".csv"  => true, // CSV is plain text — no reliable magic bytes; extension check is sufficient
            _       => false
        };
    }
}

public class ApproveRequestDto
{
    public decimal? ApprovedAmount { get; set; }
    public string?  Comment        { get; set; }
}

public class RejectRequestDto
{
    public string? Reason { get; set; }
}
