using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── RBAC note (Phase 2, updated) ─────────────────────────────────────────────
// api-bridge.js's ROLE_MAP now maps backend UserRole.ProductTeam →
// 'product_team' (and Accounts → 'accounts'), so a real ProductTeam login
// does reach the frontend correctly.
// Create/Update/Upload: Admin, Sales, ProductTeam.
// Delete (hard/soft-delete of a DSA/Partner record): Admin, ProductTeam.
// ProductTeam added per the business owner's explicit instruction: Product
// Team gets full rights (Create/Edit/Delete — everything, not view-only) over
// the DSA Management and Partner Management config modules (both live on
// this same DsaPartner entity/controller). This is a configuration-module
// right, unrelated to Loan-application visibility, which ProductTeam does
// NOT get (see LoanRepository.ApplyVisibilityScope — ProductTeam still sees
// zero loans, unchanged).
// Manager and Partner remain deliberately excluded from Create/Update/Delete —
// Manager is absent from the frontend allow-list, and Partner is a view-only
// role per the comment in efin-app.js ("partner → view only").
[Authorize]
public class DsaController : BaseController
{
    private readonly AppDbContext _db;
    private readonly LoanMS.Application.Interfaces.IFileStorageService _fileStorage;
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;

    public DsaController(AppDbContext db, LoanMS.Application.Interfaces.IFileStorageService fileStorage, LoanMS.API.Services.IRolePermissionService rolePerm)
    {
        _db = db;
        _fileStorage = fileStorage;
        _rolePerm = rolePerm;
    }

    /// <summary>
    /// Phase 4 — role-scoped: Admin/Manager/Sales keep the existing full-list
    /// behavior (unchanged). Partner now only sees their OWN Partner record
    /// (LinkedUserId == CurrentUserId) — a Partner login must never be able
    /// to browse other DSAs'/Partners' contact details, PAN, office address,
    /// etc.
    ///
    /// Dsa is broader (added per business owner, DSA ↔ Partner linkage):
    /// sees their own DSA record PLUS every Partner record mapped under
    /// them (DsaPartner.MappedDsaId — same field the Partner Management
    /// screen already uses). A Partner with no mapped DSA is unaffected —
    /// only the linkage matters, no location or other condition.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        // Menu Access Control — this one endpoint feeds BOTH the DSA
        // Management and Partner Management pages (frontend filters by
        // PartnerType client-side), so access is allowed if EITHER menu
        // permission is on for this role, not both.
        var dsaOk = await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "dsa-mgmt");
        var partnerOk = await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "partner-mgmt");
        if (!dsaOk && !partnerOk) return Forbid();

        var query = _db.DsaPartners.AsQueryable();

        if (string.Equals(CurrentUserRole, "Partner", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(d => d.LinkedUserId == CurrentUserId);
        }
        else if (string.Equals(CurrentUserRole, "Dsa", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(d =>
                d.LinkedUserId == CurrentUserId ||
                (d.MappedDsa != null && d.MappedDsa.LinkedUserId == CurrentUserId));
        }

        var dsa = await query
            .Include(d => d.MappedSalesUser)
            .Include(d => d.LinkedUser)
            .Include(d => d.MappedDsa)
            .OrderBy(d => d.Name)
            .Select(d => new {
                d.Id, d.Name, d.Code, d.Email, d.Phone,
                d.City, d.IsActive,
                PartnerType = d.PartnerType.ToString(),
                d.LinkedUserId,
                LinkedUser = d.LinkedUser != null ? d.LinkedUser.FullName : null,
                MappedSalesUser = d.MappedSalesUser != null ? d.MappedSalesUser.FullName : null,
                d.Pan,
                d.OfficeAddress,
                d.OfficeState,
                d.OfficePin,
                d.OfficeAddressType,
                d.Category,
                d.MappedDsaId,
                MappedDsaName = d.MappedDsa != null ? d.MappedDsa.Name : null,
                d.CreatedAt,
                d.UpdatedAt
            }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(dsa));
    }

    /// <summary>
    /// 🟡 DSA/Partner Export (item #11) — same role-based visibility scoping
    /// as GetAll above (Partner sees only their own record, Dsa sees own +
    /// linked partners, everyone else sees all), reused verbatim rather than
    /// a second/looser rule, so export can never expose a record the same
    /// caller couldn't already see in the list view.
    /// </summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export()
    {
        var query = _db.DsaPartners.AsQueryable();

        if (string.Equals(CurrentUserRole, "Partner", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(d => d.LinkedUserId == CurrentUserId);
        }
        else if (string.Equals(CurrentUserRole, "Dsa", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(d =>
                d.LinkedUserId == CurrentUserId ||
                (d.MappedDsa != null && d.MappedDsa.LinkedUserId == CurrentUserId));
        }

        var rows = await query
            .Include(d => d.MappedDsa)
            .OrderBy(d => d.Name)
            .Select(d => new
            {
                d.Name, d.Code, PartnerType = d.PartnerType.ToString(), d.Email, d.Phone,
                d.City, d.IsActive, d.Pan, d.OfficeAddress, d.OfficeState, d.OfficePin,
                MappedDsaName = d.MappedDsa != null ? d.MappedDsa.Name : null, d.CreatedAt
            })
            .ToListAsync();

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("Name,Code,Type,Email,Phone,City,Active,PAN,Office Address,State,PIN,Mapped DSA,Created At");
        foreach (var r in rows)
        {
            sb.AppendLine(string.Join(",",
                DsaCsvField(r.Name), DsaCsvField(r.Code), DsaCsvField(r.PartnerType), DsaCsvField(r.Email), DsaCsvField(r.Phone),
                DsaCsvField(r.City), DsaCsvField(r.IsActive), DsaCsvField(r.Pan), DsaCsvField(r.OfficeAddress),
                DsaCsvField(r.OfficeState), DsaCsvField(r.OfficePin), DsaCsvField(r.MappedDsaName),
                DsaCsvField(r.CreatedAt.ToString("yyyy-MM-dd"))));
        }

        var bytes = System.Text.Encoding.UTF8.GetBytes(sb.ToString());
        return File(bytes, "text/csv", $"dsa_partners_export_{DateTime.UtcNow:yyyyMMdd_HHmmss}.csv");
    }

    private static string DsaCsvField(object? value)
    {
        var s = value?.ToString() ?? "";
        return s.Contains(',') || s.Contains('"') || s.Contains('\n') ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Sales,ProductTeam")]
    public async Task<IActionResult> Create([FromBody] DsaDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(ApiResponseDto<object>.Fail("Name is required."));

        // A Partner may map to a DSA; a DSA must not map to itself/another DSA.
        if (dto.MappedDsaId.HasValue)
        {
            if (dto.PartnerType != LoanMS.Domain.Enums.PartnerType.Partner)
                return BadRequest(ApiResponseDto<object>.Fail("Only Partner records can be mapped to a DSA."));
            var dsaExists = await _db.DsaPartners.AnyAsync(d =>
                d.Id == dto.MappedDsaId.Value && d.PartnerType == LoanMS.Domain.Enums.PartnerType.Dsa);
            if (!dsaExists)
                return BadRequest(ApiResponseDto<object>.Fail("Mapped DSA not found."));
        }

        var dsa = new DsaPartner {
            Name = dto.Name, Code = dto.Code, Email = dto.Email,
            Phone = dto.Phone, City = dto.City, MappedSalesUserId = dto.MappedSalesUserId,
            PartnerType = dto.PartnerType, LinkedUserId = dto.LinkedUserId,
            IsActive = dto.IsActive ?? true,
            Pan = dto.Pan, OfficeAddress = dto.OfficeAddress, OfficeState = dto.OfficeState,
            OfficePin = dto.OfficePin, OfficeAddressType = dto.OfficeAddressType,
            Category = dto.Category, MappedDsaId = dto.MappedDsaId,
            CreatedAt = DateTime.UtcNow
        };
        _db.DsaPartners.Add(dsa);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { dsa.Id }, "DSA created."));
    }

    /// <summary>
    /// Archive/Restore a DSA or Partner [Admin/Sales/ProductTeam — same
    /// roles as Update above]. Dedicated, minimal endpoint — same
    /// reasoning as UsersController.SetStatus/TeamsController.SetStatus:
    /// reusing the full Update() above would need every field resent
    /// correctly just to flip one flag, and DsaDto's shape doesn't even
    /// expose MappedSalesUserId's raw id anywhere in GetAll's response —
    /// a full-PUT round-trip from the list page would silently null it
    /// out. Touches only IsActive.
    /// </summary>
    public class SetDsaStatusRequestDto { public bool IsActive { get; set; } }

    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin,Sales,ProductTeam")]
    public async Task<IActionResult> SetStatus(int id, [FromBody] SetDsaStatusRequestDto request)
    {
        var dsa = await _db.DsaPartners.FindAsync(id);
        if (dsa == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        dsa.IsActive = request.IsActive;
        dsa.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Status updated."));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,Sales,ProductTeam")]
    public async Task<IActionResult> Update(int id, [FromBody] DsaDto dto)
    {
        var dsa = await _db.DsaPartners.FindAsync(id);
        if (dsa == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));

        if (dto.MappedDsaId.HasValue)
        {
            if (dto.PartnerType != LoanMS.Domain.Enums.PartnerType.Partner)
                return BadRequest(ApiResponseDto<bool>.Fail("Only Partner records can be mapped to a DSA."));
            if (dto.MappedDsaId.Value == id)
                return BadRequest(ApiResponseDto<bool>.Fail("A record cannot be mapped to itself."));
            var dsaExists = await _db.DsaPartners.AnyAsync(d =>
                d.Id == dto.MappedDsaId.Value && d.PartnerType == LoanMS.Domain.Enums.PartnerType.Dsa);
            if (!dsaExists)
                return BadRequest(ApiResponseDto<bool>.Fail("Mapped DSA not found."));
        }

        dsa.Name = dto.Name; dsa.Code = dto.Code; dsa.Email = dto.Email;
        dsa.Phone = dto.Phone; dsa.City = dto.City;
        dsa.MappedSalesUserId = dto.MappedSalesUserId;
        dsa.PartnerType = dto.PartnerType; dsa.LinkedUserId = dto.LinkedUserId;
        if (dto.IsActive.HasValue) dsa.IsActive = dto.IsActive.Value;
        dsa.Pan = dto.Pan; dsa.OfficeAddress = dto.OfficeAddress; dsa.OfficeState = dto.OfficeState;
        dsa.OfficePin = dto.OfficePin; dsa.OfficeAddressType = dto.OfficeAddressType;
        dsa.Category = dto.Category; dsa.MappedDsaId = dto.MappedDsaId;
        dsa.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Updated."));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> Delete(int id)
    {
        var dsa = await _db.DsaPartners.FindAsync(id);
        if (dsa == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        dsa.IsDeleted = true; dsa.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Deleted."));
    }

    // ── Documents (KYC/onboarding uploads for a DSA/Partner) ────────────────────
    // Mirrors LoansController.UploadDocument/DownloadDocument/GetDocuments —
    // files stored outside wwwroot, served only through this authenticated
    // endpoint, magic-byte validated, whitelisted document types.

    [HttpPost("{id:int}/documents")]
    [Authorize(Roles = "Admin,Sales,ProductTeam")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<IActionResult> UploadDocument(int id, IFormFile file, [FromForm] string? documentType)
    {
        var dsa = await _db.DsaPartners.FindAsync(id);
        if (dsa == null) return NotFound(ApiResponseDto<object>.Fail("DSA/Partner not found."));
        if (file == null || file.Length == 0)
            return BadRequest(ApiResponseDto<object>.Fail("No file provided."));

        if (string.IsNullOrWhiteSpace(documentType))
            return BadRequest(ApiResponseDto<object>.Fail("Document type is required."));
        var docType = documentType.ToLowerInvariant();

        var allowedExts = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".csv" };
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExts.Contains(ext))
            return BadRequest(ApiResponseDto<object>.Fail($"File type '{ext}' is not allowed."));

        if (!await IsAllowedMimeTypeAsync(file, ext))
            return BadRequest(ApiResponseDto<object>.Fail("File content does not match its extension."));

        // Whitelist mirrors the DSA doc keys used in efin-app.js (dsaDocUpload):
        // aadhar / aadhar_back, pan, compan (company docs), breg (business reg),
        // offaddr (office address proof).
        var allowedDocTypes = new[] {
            "aadhar", "aadhar_back", "pan", "compan", "breg", "offaddr", "other"
        };
        if (!allowedDocTypes.Contains(docType))
            return BadRequest(ApiResponseDto<object>.Fail("Invalid document type."));

        var fileName = $"{Guid.NewGuid()}{ext}";
        var storageKey = $"dsa/{id}/{fileName}";

        await using (var stream = file.OpenReadStream())
            await _fileStorage.SaveAsync(storageKey, stream, file.ContentType);

        var docRecord = new DsaDocument {
            DsaPartnerId     = id,
            DocumentName     = Path.GetFileNameWithoutExtension(file.FileName),
            DocumentType     = docType,
            FilePath         = $"{id}/{fileName}",
            FileSizeBytes    = file.Length,
            UploadedByUserId = CurrentUserId.ToString(),
            CreatedAt        = DateTime.UtcNow
        };
        _db.DsaDocuments.Add(docRecord);
        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<object>.Ok(new {
            id            = docRecord.Id,
            documentName  = docRecord.DocumentName,
            documentType  = docRecord.DocumentType,
            fileRef       = docRecord.FilePath,
            fileSizeBytes = docRecord.FileSizeBytes,
            uploadedAt    = docRecord.CreatedAt
        }, "Document uploaded successfully."));
    }

    [HttpGet("{id:int}/documents/{fileName}")]
    public async Task<IActionResult> DownloadDocument(int id, string fileName)
    {
        if (fileName.Contains("..") || fileName.Contains('/') || fileName.Contains('\\'))
            return BadRequest(ApiResponseDto<object>.Fail("Invalid file reference."));

        var dsa = await _db.DsaPartners.FindAsync(id);
        if (dsa == null) return NotFound(ApiResponseDto<object>.Fail("DSA/Partner not found."));

        var storageKey = $"dsa/{id}/{fileName}";
        var result = await _fileStorage.GetAsync(storageKey);
        if (result == null)
            return NotFound(ApiResponseDto<object>.Fail("Document not found."));

        var (content, storedContentType) = result.Value;
        var contentType = storedContentType;
        if (string.IsNullOrWhiteSpace(contentType))
        {
            var provider = new FileExtensionContentTypeProvider();
            if (!provider.TryGetContentType(fileName, out contentType!))
                contentType = "application/octet-stream";
        }

        using var ms = new MemoryStream();
        await content.CopyToAsync(ms);
        content.Dispose();
        return File(ms.ToArray(), contentType, fileName);
    }

    [HttpGet("{id:int}/documents")]
    public async Task<IActionResult> GetDocuments(int id)
    {
        var dsa = await _db.DsaPartners.FindAsync(id);
        if (dsa == null) return NotFound(ApiResponseDto<object>.Fail("DSA/Partner not found."));

        var docs = await _db.DsaDocuments
            .Where(d => d.DsaPartnerId == id && !d.IsDeleted)
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => new {
                id            = d.Id,
                documentName  = d.DocumentName,
                documentType  = d.DocumentType,
                fileRef       = d.FilePath,
                fileSizeBytes = d.FileSizeBytes,
                uploadedAt    = d.CreatedAt
            })
            .ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(docs));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Validate file magic bytes against allowed extensions. Same
    /// implementation as LoansController.IsAllowedMimeTypeAsync.</summary>
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
            ".csv"  => true,
            _       => false
        };
    }
}

public class DsaDto {
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? City { get; set; }
    public int? MappedSalesUserId { get; set; }
    public LoanMS.Domain.Enums.PartnerType PartnerType { get; set; } = LoanMS.Domain.Enums.PartnerType.Dsa;
    public int? LinkedUserId { get; set; }

    // ── Phase 2 additions ──
    public bool? IsActive { get; set; }
    public string? Pan { get; set; }
    public string? OfficeAddress { get; set; }
    public string? OfficeState { get; set; }
    public string? OfficePin { get; set; }
    public string? OfficeAddressType { get; set; }
    public string? Category { get; set; }
    public int? MappedDsaId { get; set; }
}
