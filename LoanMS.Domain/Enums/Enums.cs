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
    Car = 5
}

public enum UserRole
{
    Admin = 0,
    Manager = 1,
    Sales = 2
}
