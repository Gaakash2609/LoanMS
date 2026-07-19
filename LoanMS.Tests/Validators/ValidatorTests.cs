using FluentValidation.TestHelper;
using LoanMS.Application.DTOs;
using LoanMS.Application.Validators;
using LoanMS.Domain.Enums;
using FluentAssertions;

namespace LoanMS.Tests.Validators;

public class CreateLoanValidatorTests
{
    private readonly CreateLoanValidator _validator = new();

    [Fact]
    public void ShouldFail_WhenCustomerIdIsZero()
    {
        var result = _validator.TestValidate(new CreateLoanRequestDto { CustomerId = 0, RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12 });
        result.ShouldHaveValidationErrorFor(x => x.CustomerId);
    }

    [Fact]
    public void ShouldFail_WhenAmountIsNegative()
    {
        var result = _validator.TestValidate(new CreateLoanRequestDto { CustomerId = 1, RequestedAmount = -1000, InterestRate = 10, TenureMonths = 12 });
        result.ShouldHaveValidationErrorFor(x => x.RequestedAmount);
    }

    [Fact]
    public void ShouldFail_WhenInterestRateExceeds50()
    {
        var result = _validator.TestValidate(new CreateLoanRequestDto { CustomerId = 1, RequestedAmount = 100000, InterestRate = 55, TenureMonths = 12 });
        result.ShouldHaveValidationErrorFor(x => x.InterestRate);
    }

    [Fact]
    public void ShouldPass_WithValidData()
    {
        var result = _validator.TestValidate(new CreateLoanRequestDto { CustomerId = 1, RequestedAmount = 500000, InterestRate = 12, TenureMonths = 60, LoanType = LoanType.Personal });
        result.ShouldNotHaveAnyValidationErrors();
    }
}

public class CreateCustomerValidatorTests
{
    private readonly CreateCustomerValidator _validator = new();

    [Fact]
    public void ShouldFail_WhenPhoneIsInvalid()
    {
        var result = _validator.TestValidate(new CreateCustomerRequestDto { FullName = "Test", Email = "a@a.com", Phone = "123" });
        result.ShouldHaveValidationErrorFor(x => x.Phone);
    }

    [Fact]
    public void ShouldFail_WhenPanIsInvalidFormat()
    {
        var result = _validator.TestValidate(new CreateCustomerRequestDto { FullName = "Test", Email = "a@a.com", Phone = "9999999999", PanNumber = "INVALID" });
        result.ShouldHaveValidationErrorFor(x => x.PanNumber);
    }

    [Fact]
    public void ShouldPass_WhenPanIsValid()
    {
        var result = _validator.TestValidate(new CreateCustomerRequestDto { FullName = "Test", Email = "a@a.com", Phone = "9999999999", PanNumber = "ABCDE1234F" });
        result.ShouldNotHaveValidationErrorFor(x => x.PanNumber);
    }

    [Fact]
    public void ShouldPass_WithMinimalValidData()
    {
        var result = _validator.TestValidate(new CreateCustomerRequestDto { FullName = "John Doe", Email = "john@example.com", Phone = "9876543210" });
        result.ShouldNotHaveAnyValidationErrors();
    }
}

public class LoginValidatorTests
{
    private readonly LoginRequestValidator _validator = new();

    [Fact]
    public void ShouldFail_WhenPasswordTooShort()
    {
        var result = _validator.TestValidate(new LoginRequestDto { Email = "a@a.com", Password = "123" });
        result.ShouldHaveValidationErrorFor(x => x.Password);
    }

    [Fact]
    public void ShouldPass_WithValidCredentials()
    {
        var result = _validator.TestValidate(new LoginRequestDto { Email = "admin@efin.com", Password = "Admin@123" });
        result.ShouldNotHaveAnyValidationErrors();
    }
}
