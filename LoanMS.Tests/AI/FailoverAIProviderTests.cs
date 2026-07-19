using LoanMS.Application.AI;
using LoanMS.Infrastructure.AI;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using FluentAssertions;

namespace LoanMS.Tests.AI;

/// <summary>
/// Tests for the automatic Gemini -> OpenAI failover mechanism. Each test uses
/// a unique provider name (via a GUID suffix) because FailoverAIProvider's
/// cooldown tracking is process-wide (static) by design — matching
/// AiResilienceHandler's existing static circuit-breaker pattern — so tests
/// must not share provider names to stay isolated from one another.
/// </summary>
public class FailoverAIProviderTests
{
    private static string Unique(string baseName) => $"{baseName}-{Guid.NewGuid():N}";

    private static Mock<IAIProvider> MakeProvider(string name, bool supportsVision = true)
    {
        var mock = new Mock<IAIProvider>();
        mock.SetupGet(p => p.ProviderName).Returns(name);
        mock.SetupGet(p => p.SupportsVision).Returns(supportsVision);
        return mock;
    }

    [Fact]
    public async Task CompleteAsync_WhenPrimaryHealthy_UsesPrimaryProvider()
    {
        var gemini = MakeProvider(Unique("gemini"));
        var openai = MakeProvider(Unique("openai"));
        gemini.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ReturnsAsync("gemini-response");

        var failover = new FailoverAIProvider(new[] { gemini.Object, openai.Object }, NullLogger<FailoverAIProvider>.Instance);
        var result = await failover.CompleteAsync("sys", "user");

        result.Should().Be("gemini-response");
        openai.Verify(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()), Times.Never);
    }

    [Fact]
    public async Task CompleteAsync_WhenPrimaryReturns404_AutomaticallyFailsOverToSecondary()
    {
        var gemini = MakeProvider(Unique("gemini"));
        var openai = MakeProvider(Unique("openai"));
        gemini.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ThrowsAsync(new HttpRequestException("model not found", null, System.Net.HttpStatusCode.NotFound));
        openai.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ReturnsAsync("openai-response");

        var failover = new FailoverAIProvider(new[] { gemini.Object, openai.Object }, NullLogger<FailoverAIProvider>.Instance);
        var result = await failover.CompleteAsync("sys", "user");

        result.Should().Be("openai-response");
        gemini.Verify(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()), Times.Once);
    }

    [Theory]
    [InlineData(System.Net.HttpStatusCode.NotFound)]        // 404
    [InlineData(System.Net.HttpStatusCode.Gone)]            // 410
    [InlineData(System.Net.HttpStatusCode.TooManyRequests)] // 429
    [InlineData(System.Net.HttpStatusCode.InternalServerError)] // 5xx
    [InlineData(System.Net.HttpStatusCode.ServiceUnavailable)]  // 5xx
    public async Task CompleteAsync_ForEachRequiredFailureType_FailsOverToSecondary(System.Net.HttpStatusCode status)
    {
        var gemini = MakeProvider(Unique("gemini"));
        var openai = MakeProvider(Unique("openai"));
        gemini.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ThrowsAsync(new HttpRequestException("failure", null, status));
        openai.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ReturnsAsync("openai-response");

        var failover = new FailoverAIProvider(new[] { gemini.Object, openai.Object }, NullLogger<FailoverAIProvider>.Instance);
        var result = await failover.CompleteAsync("sys", "user");

        result.Should().Be("openai-response");
    }

    [Fact]
    public async Task CompleteAsync_OnTimeout_FailsOverToSecondary()
    {
        var gemini = MakeProvider(Unique("gemini"));
        var openai = MakeProvider(Unique("openai"));
        gemini.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ThrowsAsync(new TimeoutException("timed out"));
        openai.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ReturnsAsync("openai-response");

        var failover = new FailoverAIProvider(new[] { gemini.Object, openai.Object }, NullLogger<FailoverAIProvider>.Instance);
        var result = await failover.CompleteAsync("sys", "user");

        result.Should().Be("openai-response");
    }

    [Fact]
    public async Task CompleteAsync_AfterFailover_SkipsUnhealthyProviderOnNextCall()
    {
        var geminiName = Unique("gemini");
        var openaiName = Unique("openai");
        var gemini = MakeProvider(geminiName);
        var openai = MakeProvider(openaiName);
        gemini.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ThrowsAsync(new HttpRequestException("down", null, System.Net.HttpStatusCode.ServiceUnavailable));
        openai.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ReturnsAsync("openai-response");

        var failover = new FailoverAIProvider(new[] { gemini.Object, openai.Object }, NullLogger<FailoverAIProvider>.Instance);

        // First call: Gemini fails, OpenAI serves it, Gemini is marked unhealthy.
        await failover.CompleteAsync("sys", "user1");
        // Second call, shortly after: Gemini should be SKIPPED (still cooling down),
        // going straight to OpenAI — verified by Gemini not being called again.
        gemini.Invocations.Clear();
        await failover.CompleteAsync("sys", "user2");

        gemini.Verify(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()), Times.Never,
            "a provider that just failed should be skipped on the very next call, not hammered immediately");
    }

    [Fact]
    public async Task CompleteAsync_WhenBothProvidersFail_PropagatesTheRealError()
    {
        var gemini = MakeProvider(Unique("gemini"));
        var openai = MakeProvider(Unique("openai"));
        gemini.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ThrowsAsync(new HttpRequestException("gemini down", null, System.Net.HttpStatusCode.ServiceUnavailable));
        openai.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
              .ThrowsAsync(new HttpRequestException("openai down", null, System.Net.HttpStatusCode.ServiceUnavailable));

        var failover = new FailoverAIProvider(new[] { gemini.Object, openai.Object }, NullLogger<FailoverAIProvider>.Instance);

        var act = async () => await failover.CompleteAsync("sys", "user");

        var thrown = await act.Should().ThrowAsync<HttpRequestException>();
        thrown.Which.Message.Should().Contain("openai down"); // the LAST provider tried's real error
    }

    [Fact]
    public async Task ExtractFromImagesAsync_OnlyRoutesToProvidersThatSupportVision()
    {
        var textOnly = MakeProvider(Unique("textonly"), supportsVision: false);
        var vision   = MakeProvider(Unique("vision"), supportsVision: true);
        vision.Setup(p => p.ExtractFromImagesAsync(It.IsAny<IReadOnlyList<VisionImage>>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .ReturnsAsync("{\"field\":\"value\"}");

        var failover = new FailoverAIProvider(new[] { textOnly.Object, vision.Object }, NullLogger<FailoverAIProvider>.Instance);
        var result = await failover.ExtractFromImagesAsync(new List<VisionImage>(), "extract fields");

        result.Should().Be("{\"field\":\"value\"}");
        textOnly.Verify(p => p.ExtractFromImagesAsync(It.IsAny<IReadOnlyList<VisionImage>>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ExtractFromImagesAsync_WhenGeminiFails_FailsOverToOpenAI_SameResultFormat()
    {
        var gemini = MakeProvider(Unique("gemini"));
        var openai = MakeProvider(Unique("openai"));
        gemini.Setup(p => p.ExtractFromImagesAsync(It.IsAny<IReadOnlyList<VisionImage>>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .ThrowsAsync(new HttpRequestException("model retired", null, System.Net.HttpStatusCode.NotFound));
        openai.Setup(p => p.ExtractFromImagesAsync(It.IsAny<IReadOnlyList<VisionImage>>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .ReturnsAsync("{\"full_name\":\"TEST\",\"pan_number\":\"ABCDE1234F\"}");

        var failover = new FailoverAIProvider(new[] { gemini.Object, openai.Object }, NullLogger<FailoverAIProvider>.Instance);
        var images = new List<VisionImage> { new() { MediaType = "image/jpeg", Data = "base64data" } };
        var result = await failover.ExtractFromImagesAsync(images, "extract PAN fields");

        // Same string-JSON contract the KYC controller already expects from Gemini —
        // the caller-side parsing logic requires zero changes.
        result.Should().Be("{\"full_name\":\"TEST\",\"pan_number\":\"ABCDE1234F\"}");
    }

    [Fact]
    public async Task IsAvailableAsync_TrueIfAnyProviderIsAvailable()
    {
        var gemini = MakeProvider(Unique("gemini"));
        var openai = MakeProvider(Unique("openai"));
        gemini.Setup(p => p.IsAvailableAsync()).ReturnsAsync(false);
        openai.Setup(p => p.IsAvailableAsync()).ReturnsAsync(true);

        var failover = new FailoverAIProvider(new[] { gemini.Object, openai.Object }, NullLogger<FailoverAIProvider>.Instance);

        (await failover.IsAvailableAsync()).Should().BeTrue();
    }

    [Fact]
    public void Constructor_WithNoProviders_ThrowsArgumentException()
    {
        var act = () => new FailoverAIProvider(Array.Empty<IAIProvider>(), NullLogger<FailoverAIProvider>.Instance);
        act.Should().Throw<ArgumentException>();
    }
}
