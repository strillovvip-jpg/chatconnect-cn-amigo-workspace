using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Serialization;
using USAFiling.FaceSwap.Contracts;

namespace USAFiling.FaceSwap.Helper.Gateway;

public interface IBackendAssertionValidator
{
    Task<ValidatedHelperAssertion> ValidateAndConsumeAsync(
        string assertion,
        string helperNonce,
        CancellationToken cancellationToken);
}

public sealed class BackendAssertionValidator(
    HttpClient httpClient,
    IConfiguration configuration) : IBackendAssertionValidator
{
    public async Task<ValidatedHelperAssertion> ValidateAndConsumeAsync(
        string assertion,
        string helperNonce,
        CancellationToken cancellationToken)
    {
        var endpoint = configuration["Helper:AssertionValidationUrl"];
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var validationUri) ||
            validationUri.Scheme != Uri.UriSchemeHttps)
            throw new HelperGatewayException("VALIDATOR_UNAVAILABLE", "Backend assertion validation is not configured.");

        using var response = await httpClient.PostAsJsonAsync(
            validationUri,
            new { assertionId = assertion, helperNonce },
            cancellationToken);
        if (!response.IsSuccessStatusCode)
            throw new HelperGatewayException("INVALID_ASSERTION", "The helper assertion was rejected.");

        var validated = await response.Content.ReadFromJsonAsync<BackendValidationResponse>(cancellationToken);
        if (validated is null)
            throw new HelperGatewayException("INVALID_ASSERTION", "The helper assertion response was invalid.");

        return new ValidatedHelperAssertion(
            Hash(assertion),
            validated.AuthorizationCode,
            validated.DeviceId,
            validated.Origin,
            Hash(helperNonce),
            DateTimeOffset.FromUnixTimeMilliseconds(validated.ExpiresAt));
    }

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value.Trim()))).ToLowerInvariant();

    private sealed record BackendValidationResponse(
        [property: JsonPropertyName("authorizationCode")] string AuthorizationCode,
        [property: JsonPropertyName("deviceId")] string DeviceId,
        [property: JsonPropertyName("origin")] string Origin,
        [property: JsonPropertyName("expiresAt")] long ExpiresAt);
}

public static class HelperEndpoints
{
    public static IEndpointRouteBuilder MapHelperEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/v1/status", (HttpContext context, IOriginPolicy origins) =>
        {
            RequireAllowedOrigin(context, origins);
            return Results.Json(
                new HelperStatus(ApiVersion.Current, "0.1.0", false, false, "idle"),
                HelperJsonContext.Default.HelperStatus);
        });

        endpoints.MapPost(
            "/v1/session",
            async (
                HttpContext context,
                CreateSessionRequest request,
                IOriginPolicy origins,
                IBackendAssertionValidator validator,
                ISessionRegistry sessions,
                CancellationToken cancellationToken) =>
            {
                var origin = RequireAllowedOrigin(context, origins);
                var assertion = await validator.ValidateAndConsumeAsync(
                    request.Assertion,
                    request.HelperNonce,
                    cancellationToken);
                if (!string.Equals(assertion.AllowedOrigin, origin, StringComparison.Ordinal) ||
                    !string.Equals(assertion.DeviceId, request.DeviceId, StringComparison.Ordinal))
                    throw new HelperGatewayException("INVALID_ASSERTION", "The helper assertion scope does not match.");
                var session = sessions.Create(assertion, request.HelperNonce);
                return Results.Json(
                    new CreateSessionResponse(session.SessionId, session.ExpiresAt.ToUnixTimeMilliseconds()),
                    HelperJsonContext.Default.CreateSessionResponse);
            });

        return endpoints;
    }

    public static IApplicationBuilder UseExactOriginCors(this IApplicationBuilder app) =>
        app.Use(async (context, next) =>
        {
            var origin = context.Request.Headers.Origin.ToString();
            var policy = context.RequestServices.GetRequiredService<IOriginPolicy>();
            if (policy.IsAllowed(origin))
            {
                context.Response.Headers.AccessControlAllowOrigin = origin;
                context.Response.Headers.Vary = "Origin";
                context.Response.Headers.AccessControlAllowHeaders = "content-type,x-helper-session,x-helper-nonce";
                context.Response.Headers.AccessControlAllowMethods = "GET,POST,DELETE,OPTIONS";
            }
            if (HttpMethods.IsOptions(context.Request.Method))
            {
                context.Response.StatusCode = policy.IsAllowed(origin) ? StatusCodes.Status204NoContent : StatusCodes.Status403Forbidden;
                return;
            }
            await next(context);
        });

    private static string RequireAllowedOrigin(HttpContext context, IOriginPolicy origins)
    {
        var origin = context.Request.Headers.Origin.ToString();
        if (!origins.IsAllowed(origin))
            throw new HelperGatewayException("ORIGIN_DENIED", "The requesting origin is not allowed.");
        return origin;
    }
}
