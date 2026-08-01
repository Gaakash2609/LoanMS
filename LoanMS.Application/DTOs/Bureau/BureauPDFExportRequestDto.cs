using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class BureauPDFExportRequestDto
{
    public int BureauReportId { get; set; }
    public bool IncludeAccountDetails { get; set; } = true;
    public bool IncludePaymentHistory { get; set; } = true;
    public bool IncludeRiskAnalysis { get; set; } = true;
}
