using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class AddressDto
{
    public string? Type { get; set; }
    public string? Street { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? PostalCode { get; set; }
    public string? Country { get; set; }
    public DateTime? DateReported { get; set; }
}
