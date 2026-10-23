using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace USAFiling.FaceSwap.Helper.Gateway;

public sealed record ValidatedHelperAssertion(
    string AssertionHash,
    string AuthorizationCode,
    string DeviceId,
    string AllowedOrigin,
    string NonceHash,
    DateTimeOffset ExpiresAt);

public sealed record HelperSession(
    string SessionId,
    string AuthorizationCode,
    string DeviceId,
    string AllowedOrigin,
    string NonceHash,
    DateTimeOffset ExpiresAt);

public sealed class HelperGatewayException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

public interface ISessionRegistry
{
    HelperSession Create(ValidatedHelperAssertion assertion, string helperNonce);
    HelperSession Validate(string sessionId, string helperNonce);
    bool Delete(string sessionId);
}

public sealed class SessionRegistry(TimeProvider timeProvider) : ISessionRegistry
{
    private readonly ConcurrentDictionary<string, HelperSession> sessions = new();
    private readonly ConcurrentDictionary<string, byte> consumedAssertions = new();

    public HelperSession Create(ValidatedHelperAssertion assertion, string helperNonce)
    {
        if (string.IsNullOrWhiteSpace(helperNonce))
            throw new HelperGatewayException("MISSING_NONCE", "A helper nonce is required.");
        if (!FixedTimeEquals(assertion.NonceHash, Hash(helperNonce)))
            throw new HelperGatewayException("INVALID_ASSERTION", "The helper assertion does not match this browser session.");
        if (assertion.ExpiresAt <= timeProvider.GetUtcNow())
            throw new HelperGatewayException("EXPIRED_ASSERTION", "The helper assertion has expired.");
        if (!consumedAssertions.TryAdd(assertion.AssertionHash, 0))
            throw new HelperGatewayException("REPLAYED_ASSERTION", "The helper assertion has already been used.");

        var sessionId = EncodeBase64Url(RandomNumberGenerator.GetBytes(32));
        var session = new HelperSession(
            sessionId,
            assertion.AuthorizationCode,
            assertion.DeviceId,
            assertion.AllowedOrigin,
            assertion.NonceHash,
            assertion.ExpiresAt);
        if (!sessions.TryAdd(sessionId, session))
            throw new HelperGatewayException("SESSION_CREATION_FAILED", "Unable to create the helper session.");
        return session;
    }

    public HelperSession Validate(string sessionId, string helperNonce)
    {
        if (!sessions.TryGetValue(sessionId, out var session) ||
            session.ExpiresAt <= timeProvider.GetUtcNow() ||
            !FixedTimeEquals(session.NonceHash, Hash(helperNonce)))
            throw new HelperGatewayException("INVALID_SESSION", "The helper session is invalid or expired.");
        return session;
    }

    public bool Delete(string sessionId) => sessions.TryRemove(sessionId, out _);

    internal static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value.Trim()))).ToLowerInvariant();

    private static bool FixedTimeEquals(string left, string right) =>
        CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(left),
            Encoding.ASCII.GetBytes(right));

    private static string EncodeBase64Url(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
