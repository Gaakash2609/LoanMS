using AutoMapper;
using LoanMS.Application.Mappings;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace LoanMS.Tests.Services;

/// <summary>
/// Program.cs runs AssertConfigurationIsValid() at startup in Development and
/// refuses to start when a mapped entity/DTO gains a member the profile does not
/// cover. That once only showed up when the API was actually launched (the
/// Customer identity keys and LoanDto.ArchivedByName, 2026-09-24) — this test
/// runs the same check, built the same way DI builds it, on every test run.
/// </summary>
public class MappingProfileValidationTests
{
    [Fact]
    public void MappingProfile_IsValid_ExactlyAsValidatedAtStartup()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddAutoMapper(typeof(MappingProfile));
        using var provider = services.BuildServiceProvider();

        provider.GetRequiredService<IMapper>().ConfigurationProvider.AssertConfigurationIsValid();
    }
}
