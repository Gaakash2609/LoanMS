using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── RBAC note (Phase 2) ──────────────────────────────────────────────────────
// Frontend dsaCanCreate()/dsaCanEdit() (efin-app.js) allow-list:
//   ['admin','team_leader','login_team','sales_executive','product_team']
// But api-bridge.js's ROLE_MAP — the ONLY place a backend UserRole becomes a
// frontend role string — only ever produces: admin, manager, sales_executive,
// login_team (mapped from 'Operations', which does not exist in the backend
// UserRole enum, so dead), partner. 'team_leader' and 'product_team' are never
// produced by any real login. Backend UserRole enum = Admin, Manager, Sales,
// Dsa, Partner. Intersecting the frontend allow-list with roles a real login
// can actually produce gives exactly: Admin, Sales ('sales_executive').
// Manager and Partner are deliberately excluded — Manager is absent from the
// frontend allow-list, and Partner is a view-only role per the comment in
// efin-app.js ("partner → view only"). Create/Update therefore authorize
// "Admin,Sales". Delete (hard/soft-delete of a DSA/Partner record) is not
// exercised by the frontend at all (status toggle goes through Update, not
// Delete) and remains Admin-only, matching the destructive-action convention
// used elsewhere in this codebase (TeamsController, LocationsController, etc).
[Authorize]
public class DsaController : BaseController
{
    private readonly AppDbContext _db;
    // Documents stored OUTSIDE wwwroot — never served as static files — same
    // convention as LoansController's secure_uploads.
    private static readonly string _uploadRoot =
        Path.Combine(AppContext.BaseDirectory, "secure_uploads", "dsa");

    public DsaController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var dsa = await _db.DsaPartners
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

    [HttpPost]
    [Authorize(Roles = "Admin,Sales")]
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

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,Sales")]
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
    [Authorize(Roles = "Admin")]
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
    [Authorize(Roles = "Admin,Sales")]
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

        var uploadDir = Path.Combine(_uploadRoot, id.ToString());
        Directory.CreateDirectory(uploadDir);
        var fileName = $"{Guid.NewGuid()}{ext}";
        var filePath = Path.Combine(uploadDir, fileName);

        await using (var stream = new FileStream(filePath, FileMode.Create))
            await file.CopyToAsync(stream);

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

        var filePath = Path.Combine(_uploadRoot, id.ToString(), fileName);
        if (!System.IO.File.Exists(filePath))
            return NotFound(ApiResponseDto<object>.Fail("Document not found."));

        var provider = new FileExtensionContentTypeProvider();
        if (!provider.TryGetContentType(fileName, out var contentType))
            contentType = "application/octet-stream";

        var bytes = await System.IO.File.ReadAllBytesAsync(filePath);
        return File(bytes, contentType, fileName);
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
