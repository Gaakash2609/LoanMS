using AutoMapper;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Mappings;

/// <summary>
/// AutoMapper profile — registered in DI but services use manual MapToDto() for
/// role-based PII masking (PAN/Aadhaar). These mappings are available for
/// future use and extension without breaking existing behavior.
/// All property names validated against actual DTO definitions.
/// </summary>
public class MappingProfile : Profile
{
    public MappingProfile()
    {
        // ── User ──────────────────────────────────────────────────────────────
        CreateMap<User, UserDto>()
            .ForMember(d => d.Role, o => o.MapFrom(s => s.Role.ToString()));

        // ── Customer (no PII masking — use CustomerService.MapToDto for that)
        CreateMap<Customer, CustomerDto>()
            .ForMember(d => d.TotalLoans, o => o.MapFrom(s => s.Loans != null ? s.Loans.Count : 0));

        CreateMap<CreateCustomerRequestDto, Customer>()
            .ForMember(d => d.Id,        o => o.Ignore())
            .ForMember(d => d.CreatedAt, o => o.Ignore())
            .ForMember(d => d.UpdatedAt, o => o.Ignore())
            .ForMember(d => d.IsDeleted, o => o.Ignore())
            .ForMember(d => d.Loans,     o => o.Ignore());

        CreateMap<UpdateCustomerRequestDto, Customer>()
            .ForMember(d => d.Id,        o => o.Ignore())
            .ForMember(d => d.CreatedAt, o => o.Ignore())
            .ForMember(d => d.UpdatedAt, o => o.Ignore())
            .ForMember(d => d.IsDeleted, o => o.Ignore())
            .ForMember(d => d.Loans,     o => o.Ignore());

        // ── LoanStatusHistory — FIXED: field is "ChangedBy", NOT "ChangedByName"
        CreateMap<LoanStatusHistory, LoanStatusHistoryDto>()
            .ForMember(d => d.FromStatus, o => o.MapFrom(s => s.FromStatus.ToString()))
            .ForMember(d => d.ToStatus,   o => o.MapFrom(s => s.ToStatus.ToString()))
            // DTO field = ChangedBy (string), maps from navigation property's FullName
            .ForMember(d => d.ChangedBy,  o => o.MapFrom(s => s.ChangedBy != null ? s.ChangedBy.FullName : "System"))
            // DTO field = ChangedAt, maps from CreatedAt (when status was changed)
            .ForMember(d => d.ChangedAt,  o => o.MapFrom(s => s.CreatedAt));

        // ── Loan (no role-based masking — use LoanService.MapToDto for that)
        CreateMap<Loan, LoanDto>()
            .ForMember(d => d.LoanType,     o => o.MapFrom(s => s.LoanType.ToString()))
            .ForMember(d => d.Status,        o => o.MapFrom(s => s.Status.ToString()))
            .ForMember(d => d.StatusHistory, o => o.MapFrom(s => s.StatusHistory))
            .ForMember(d => d.Customer,      o => o.MapFrom(s => s.Customer))
            .ForMember(d => d.CreatedBy,     o => o.MapFrom(s => s.CreatedBy))
            .ForMember(d => d.AssignedTo,    o => o.MapFrom(s => s.AssignedTo));

        CreateMap<Loan, LoanListDto>()
            .ForMember(d => d.LoanType,     o => o.MapFrom(s => s.LoanType.ToString()))
            .ForMember(d => d.Status,        o => o.MapFrom(s => s.Status.ToString()))
            .ForMember(d => d.CustomerName,  o => o.MapFrom(s => s.Customer != null ? s.Customer.FullName : string.Empty))
            .ForMember(d => d.CustomerPhone, o => o.MapFrom(s => s.Customer != null ? s.Customer.Phone : string.Empty))
            .ForMember(d => d.CreatedByName, o => o.MapFrom(s => s.CreatedBy != null ? s.CreatedBy.FullName : string.Empty))
            .ForMember(d => d.AssignedToName,o => o.MapFrom(s => s.AssignedTo != null ? s.AssignedTo.FullName : null));
    }
}
