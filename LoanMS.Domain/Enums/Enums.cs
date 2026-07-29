namespace LoanMS.Domain.Enums;

public enum LoanStatus
{
    Draft = 0,
    Submitted = 1,
    UnderReview = 2,
    Approved = 3,
    Rejected = 4,
    Disbursed = 5,
    Closed = 6
}

public enum LoanType
{
    Personal = 0,
    Business = 1,
    Home = 2,
    Vehicle = 3,
    Education = 4,
    Car = 5,
    LAP = 6
}

public enum UserRole
{
    Admin = 0,
    Manager = 1,
    Sales = 2,
    Dsa = 3,
    Partner = 4
}

// ── DSA / Partner classification (used by DsaPartner.PartnerType) ─────────────
public enum PartnerType
{
    Dsa = 0,
    Partner = 1
}
