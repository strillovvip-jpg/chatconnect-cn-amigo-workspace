using System.Net;
using System.Security.Cryptography;
using System.Text;
using USAFiling.FaceSwap.Helper.Gateway;

namespace USAFiling.FaceSwap.Helper.Tests;

public sealed class GatewayTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 3, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Origin_policy_allows_only_the_exact_production_origin()
    {
        var policy = new OriginPolicy(isDevelopment: false);

        Assert.True(policy.IsAllowed("https://nyfbi.org"));
        Assert.False(policy.IsAllowed("https://nyfbi.org.evil.example"));
        Assert.False(policy.IsAllowed("https://nyfbi.org/path"));
        Assert.False(policy.IsAllowed("http://nyfbi.org"));
    }

    [Fact]
    public void Development_origin_is_never_allowed_in_production()
    {
        Assert.False(new OriginPolicy(isDevelopment: false).IsAllowed("https://localhost:5173"));
        Assert.True(new OriginPolicy(isDevelopment: true).IsAllowed("https://localhost:5173"));
    }

    [Fact]
    public void Listener_binding_requires_https_on_loopback()
    {
        Assert.True(LoopbackBindingPolicy.IsAllowed(new Uri("https://127.0.0.1:43821")));
        Assert.True(LoopbackBindingPolicy.IsAllowed(new Uri("https://[::1]:43821")));
        Assert.False(LoopbackBindingPolicy.IsAllowed(new Uri("http://127.0.0.1:43821")));
        Assert.False(LoopbackBindingPolicy.IsAllowed(new Uri("https://0.0.0.0:43821")));
        Assert.False(LoopbackBindingPolicy.IsAllowed(new Uri("https://192.168.1.10:43821")));
    }

    [Fact]
    public void Session_creation_rejects_missing_or_mismatched_nonce()
    {
        var registry = NewRegistry();
        var expected = "one-time-browser-nonce";
        var assertion = Assertion("assertion-a", expected, Now.AddMinutes(5));

        Assert.Equal(
            "MISSING_NONCE",
            Assert.Throws<HelperGatewayException>(() => registry.Create(assertion, "")).Code);
        Assert.Equal(
            "INVALID_ASSERTION",
            Assert.Throws<HelperGatewayException>(() => registry.Create(assertion, "different-nonce")).Code);
    }

    [Fact]
    public void Session_creation_rejects_expired_and_replayed_assertions()
    {
        var registry = NewRegistry();
        var nonce = "one-time-browser-nonce";

        Assert.Equal(
            "EXPIRED_ASSERTION",
            Assert.Throws<HelperGatewayException>(() =>
                registry.Create(Assertion("expired", nonce, Now), nonce)).Code);

        var assertion = Assertion("single-use", nonce, Now.AddMinutes(5));
        registry.Create(assertion, nonce);
        Assert.Equal(
            "REPLAYED_ASSERTION",
            Assert.Throws<HelperGatewayException>(() => registry.Create(assertion, nonce)).Code);
    }

    [Fact]
    public void Authenticated_session_can_be_validated_then_deleted()
    {
        var registry = NewRegistry();
        var nonce = "one-time-browser-nonce";
        var created = registry.Create(Assertion("valid", nonce, Now.AddMinutes(5)), nonce);

        var validated = registry.Validate(created.SessionId, nonce);

        Assert.Equal("FULL1", validated.AuthorizationCode);
        Assert.Equal("device-full", validated.DeviceId);
        Assert.Equal("https://nyfbi.org", validated.AllowedOrigin);
        Assert.True(registry.Delete(created.SessionId));
        Assert.Throws<HelperGatewayException>(() => registry.Validate(created.SessionId, nonce));
    }

    private static SessionRegistry NewRegistry() => new(new FixedTimeProvider(Now));

    private static ValidatedHelperAssertion Assertion(
        string assertionHash,
        string nonce,
        DateTimeOffset expiresAt) =>
        new(
            assertionHash,
            "FULL1",
            "device-full",
            "https://nyfbi.org",
            Sha256(nonce),
            expiresAt);

    private static string Sha256(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }
}
