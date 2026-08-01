using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilReportUploadRequestDto
{
    public int CustomerId { get; set; }
    public string? BureauProvider { get; set; } // CIBIL, Equifax, etc.
    public string? RawFileContent { get; set; } // XML/JSON from bureau
    public DateTime FileDate { get; set; }
}
