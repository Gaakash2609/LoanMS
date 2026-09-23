using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Pins the rule that saving the mail settings form never destroys a stored
/// secret it did not carry.
///
/// The two secrets belong to different providers, and only the ACTIVE
/// provider's secret is validated as non-empty on save (SmtpPass only when
/// provider is smtp/gmail; ApiKey only when provider is brevo). The save path
/// previously kept the stored value only when the incoming one was a masked
/// placeholder — a blank fell through and was written. So saving the form on
/// Brevo posted an empty SmtpPass and silently erased the stored SMTP
/// password, and saving on SMTP did the same to the Brevo API key. The loss
/// surfaced only later, when mail stopped sending after a provider switch.
/// </summary>
public class EmailConfigSecretTests
{
    private sealed class FakeEmailConfigStore : IEmailConfigStore
    {
        public EmailConfigRecord? Current { get; set; }
        public Task<EmailConfigRecord?> GetAsync() => Task.FromResult(Current);
        public Task SaveAsync(EmailConfigRecord cfg) { Current = cfg; return Task.CompletedTask; }
        public Task ClearAsync() { Current = null; return Task.CompletedTask; }
    }

    private static (SettingsController controller, FakeEmailConfigStore store) Create(
        EmailConfigRecord existing)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new AppDbContext(options);

        var protectorMock = new Mock<IDataProtector>();
        var dpProvider = new Mock<IDataProtectionProvider>();
        dpProvider.Setup(p => p.CreateProtector(It.IsAny<string>())).Returns(protectorMock.Object);

        var store = new FakeEmailConfigStore { Current = existing };
        var controller = new SettingsController(
            db,
            dpProvider.Object,
            store,
            new Mock<LoanMS.Application.Interfaces.IEmailService>().Object);

        return (controller, store);
    }

    private static EmailConfigRecord ExistingWithBothSecrets() => new()
    {
        Provider = "smtp",
        FromEmail = "ops@efin.com",
        Name = "EFIN Ops",
        SmtpHost = "smtp.gmail.com",
        SmtpPort = "587",
        SmtpUser = "ops@efin.com",
        SmtpPass = "stored-smtp-password",
        ApiKey = "stored-brevo-key",
    };

    [Fact]
    public async Task SavingOnBrevo_DoesNotWipeTheStoredSmtpPassword()
    {
        var (controller, store) = Create(ExistingWithBothSecrets());

        // The Brevo form has no SMTP password field, so it posts blank.
        await controller.SaveEmailConfig(new EmailConfigDto
        {
            Provider = "brevo",
            FromEmail = "ops@efin.com",
            Name = "EFIN Ops",
            ApiKey = "new-brevo-key",
            SmtpPass = "",
        });

        store.Current!.ApiKey.Should().Be("new-brevo-key");
        store.Current!.SmtpPass.Should().Be("stored-smtp-password");
    }

    [Fact]
    public async Task SavingOnSmtp_DoesNotWipeTheStoredBrevoApiKey()
    {
        var (controller, store) = Create(ExistingWithBothSecrets());

        await controller.SaveEmailConfig(new EmailConfigDto
        {
            Provider = "smtp",
            FromEmail = "ops@efin.com",
            Name = "EFIN Ops",
            SmtpUser = "ops@efin.com",
            SmtpPass = "new-smtp-password",
            // ApiKey deliberately not set — the SMTP form has no Brevo key field,
            // so the property arrives at its default rather than as an explicit null.
        });

        store.Current!.SmtpPass.Should().Be("new-smtp-password");
        store.Current!.ApiKey.Should().Be("stored-brevo-key");
    }

    [Fact]
    public async Task AMaskedPlaceholderKeepsTheStoredSecret()
    {
        var (controller, store) = Create(ExistingWithBothSecrets());

        // What the UI sends back when the admin never touched the field.
        await controller.SaveEmailConfig(new EmailConfigDto
        {
            Provider = "smtp",
            FromEmail = "ops@efin.com",
            Name = "EFIN Ops",
            SmtpUser = "ops@efin.com",
            SmtpPass = "••••••••",
        });

        store.Current!.SmtpPass.Should().Be("stored-smtp-password");
    }

    [Fact]
    public async Task ARealNewSecretStillReplacesTheStoredOne()
    {
        var (controller, store) = Create(ExistingWithBothSecrets());

        await controller.SaveEmailConfig(new EmailConfigDto
        {
            Provider = "smtp",
            FromEmail = "ops@efin.com",
            Name = "EFIN Ops",
            SmtpUser = "ops@efin.com",
            SmtpPass = "rotated-password",
        });

        store.Current!.SmtpPass.Should().Be("rotated-password");
    }
}
