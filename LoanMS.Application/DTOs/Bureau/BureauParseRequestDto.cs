using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class BureauParseRequestDto
{
    public string? RawContent { get; set; }
    public string? Format { get; set; } // XML, JSON, PDF
}
