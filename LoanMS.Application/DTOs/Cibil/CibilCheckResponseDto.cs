using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilCheckResponseDto
{
    public string Pan         { get; set; } = string.Empty;
    public int?   CibilScore  { get; set; }
    public string Status      { get; set; } = string.Empty;
    public string? Message    { get; set; }
    public bool   IsEligible  { get; set; }

    /// <summary>
    /// Provenance of <see cref="CibilScore"/>. "Bureau" ONLY when the value came
    /// from a stored BureauReport (a real bureau pull); "Estimated" when it was
    /// derived locally because no bureau report exists for this PAN.
    ///
    /// This previously defaulted to "Bureau" and was hardcoded to "Bureau" on
    /// every response, including responses carrying a locally derived score.
    /// Callers cannot distinguish a real score from a derived one unless this
    /// field tells the truth, so the default is now the conservative one.
    /// </summary>
    public string Source      { get; set; } = "Estimated";

    /// <summary>
    /// True when <see cref="CibilScore"/> was derived locally rather than read
    /// from a bureau report. Explicit boolean so clients can gate rendering on a
    /// flag instead of string-matching <see cref="Source"/>. An estimated score
    /// is never written to Customer.CibilScore.
    /// </summary>
    public bool   IsEstimated { get; set; }
}
