using System.Reflection;
using FluentAssertions;
using LoanMS.API.Middleware;
using Xunit;

namespace LoanMS.Tests.Middleware;

/// <summary>
/// AuditMiddleware stores request bodies in AuditLogs. Credentials that the
/// app keeps ENCRYPTED in settings (InCred client secret, AI API keys, SMTP
/// password, webhook secrets) used to be copied there in plain text.
/// </summary>
public class AuditMaskingTests
{
    private static string Mask(string json) =>
        (string)typeof(AuditMiddleware)
            .GetMethod("MaskPiiFields", BindingFlags.NonPublic | BindingFlags.Static)!
            .Invoke(null, new object[] { json })!;

    [Theory]
    [InlineData("{\"baseUrl\":\"u\",\"clientId\":\"c\",\"clientSecret\":\"S3CRET\"}")]
    [InlineData("{\"provider\":\"gemini\",\"apiKey\":\"S3CRET\"}")]
    [InlineData("{\"smtpHost\":\"h\",\"smtpPass\":\"S3CRET\"}")]
    [InlineData("{\"token\":\"S3CRET\",\"newPassword\":\"S3CRET\"}")]
    [InlineData("{\"key\":\"incred_webhook_secret\",\"value\":\"S3CRET\",\"category\":\"incred\"}")]
    public void Credentials_AreRedacted(string body)
    {
        var masked = Mask(body);
        masked.Should().NotContain("S3CRET");
        masked.Should().Contain("[REDACTED]");
    }

    [Fact]
    public void NonSecretSetting_ValueIsKept()
    {
        Mask("{\"key\":\"efin_brand_name\",\"value\":\"MudraHub\"}").Should().Contain("MudraHub");
    }
}
