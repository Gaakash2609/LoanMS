using FluentValidation;
using LoanMS.Application.DTOs;

namespace LoanMS.Application.Validators;

// ── Login ─────────────────────────────────────────────────────────────────────
public class LoginRequestValidator : AbstractValidator<LoginRequestDto>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required.")
            .EmailAddress().WithMessage("Invalid email format.");

        RuleFor(x => x.Password)
            .NotEmpty().WithMessage("Password is required.")
            .MinimumLength(6).WithMessage("Password must be at least 6 characters.");
    }
}

// ── Create Customer ───────────────────────────────────────────────────────────
public class CreateCustomerValidator : AbstractValidator<CreateCustomerRequestDto>
{
    public CreateCustomerValidator()
    {
        RuleFor(x => x.FullName)
            .NotEmpty().WithMessage("Full name is required.")
            .MaximumLength(150).WithMessage("Name cannot exceed 150 characters.");

        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required.")
            .EmailAddress().WithMessage("Invalid email format.");

        RuleFor(x => x.Phone)
            .NotEmpty().WithMessage("Phone is required.")
            .Matches(@"^\d{10}$").WithMessage("Phone must be exactly 10 digits.");

        RuleFor(x => x.PanNumber)
            .Matches(@"^[A-Z]{5}[0-9]{4}[A-Z]{1}$")
            .WithMessage("Invalid PAN format (e.g. ABCDE1234F).")
            .When(x => !string.IsNullOrWhiteSpace(x.PanNumber));

        RuleFor(x => x.AadhaarNumber)
            .Matches(@"^\d{12}$")
            .WithMessage("Aadhaar must be 12 digits.")
            .When(x => !string.IsNullOrWhiteSpace(x.AadhaarNumber));

        RuleFor(x => x.CibilScore)
            .InclusiveBetween(300, 900)
            .WithMessage("CIBIL score must be between 300 and 900.")
            .When(x => x.CibilScore.HasValue);

        RuleFor(x => x.MonthlyIncome)
            .GreaterThan(0).WithMessage("Monthly income must be positive.")
            .When(x => x.MonthlyIncome.HasValue);
    }
}

// ── Update Customer (same rules) ──────────────────────────────────────────────
public class UpdateCustomerValidator : AbstractValidator<UpdateCustomerRequestDto>
{
    public UpdateCustomerValidator()
    {
        RuleFor(x => x.FullName)
            .NotEmpty().WithMessage("Full name is required.")
            .MaximumLength(150);

        RuleFor(x => x.Email)
            .NotEmpty().EmailAddress().WithMessage("Invalid email format.");

        RuleFor(x => x.Phone)
            .NotEmpty().Matches(@"^\d{10}$").WithMessage("Phone must be 10 digits.");

        RuleFor(x => x.PanNumber)
            .Matches(@"^[A-Z]{5}[0-9]{4}[A-Z]{1}$")
            .WithMessage("Invalid PAN format.")
            .When(x => !string.IsNullOrWhiteSpace(x.PanNumber));

        RuleFor(x => x.CibilScore)
            .InclusiveBetween(300, 900)
            .When(x => x.CibilScore.HasValue);

        RuleFor(x => x.MonthlyIncome)
            .GreaterThan(0)
            .When(x => x.MonthlyIncome.HasValue);
    }
}

// ── Create Loan ───────────────────────────────────────────────────────────────
public class CreateLoanValidator : AbstractValidator<CreateLoanRequestDto>
{
    public CreateLoanValidator()
    {
        RuleFor(x => x.CustomerId)
            .GreaterThan(0).WithMessage("Valid customer ID is required.");

        RuleFor(x => x.RequestedAmount)
            .GreaterThan(0).WithMessage("Requested amount must be greater than 0.")
            .LessThanOrEqualTo(100_000_000m).WithMessage("Amount exceeds maximum allowed (₹10 Cr).");

        RuleFor(x => x.InterestRate)
            .GreaterThan(0).WithMessage("Interest rate must be greater than 0.")
            .LessThanOrEqualTo(50m).WithMessage("Interest rate cannot exceed 50%.");

        RuleFor(x => x.TenureMonths)
            .GreaterThan(0).WithMessage("Tenure must be at least 1 month.")
            .LessThanOrEqualTo(360).WithMessage("Tenure cannot exceed 360 months (30 years).");
    }
}

// ── Update Loan ───────────────────────────────────────────────────────────────
public class UpdateLoanValidator : AbstractValidator<UpdateLoanRequestDto>
{
    public UpdateLoanValidator()
    {
        RuleFor(x => x.RequestedAmount)
            .GreaterThan(0).WithMessage("Amount must be greater than 0.")
            .LessThanOrEqualTo(100_000_000m);

        RuleFor(x => x.InterestRate)
            .GreaterThan(0).LessThanOrEqualTo(50m);

        RuleFor(x => x.TenureMonths)
            .GreaterThan(0).LessThanOrEqualTo(360);
    }
}

// ── Change Password ───────────────────────────────────────────────────────────
public class ChangePasswordValidator : AbstractValidator<ChangePasswordRequestDto>
{
    public ChangePasswordValidator()
    {
        RuleFor(x => x.CurrentPassword)
            .NotEmpty().WithMessage("Current password is required.");

        RuleFor(x => x.NewPassword)
            .NotEmpty().WithMessage("New password is required.")
            .MinimumLength(8).WithMessage("Password must be at least 8 characters.")
            .Matches(@"[A-Z]").WithMessage("Must contain at least one uppercase letter.")
            .Matches(@"[0-9]").WithMessage("Must contain at least one digit.")
            .Matches(@"[^a-zA-Z0-9]").WithMessage("Must contain at least one special character.");
    }
}
