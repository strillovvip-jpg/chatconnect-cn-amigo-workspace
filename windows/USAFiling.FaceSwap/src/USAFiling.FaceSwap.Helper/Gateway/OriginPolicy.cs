using System.Net;

namespace USAFiling.FaceSwap.Helper.Gateway;

public interface IOriginPolicy
{
    bool IsAllowed(string? origin);
}

public sealed class OriginPolicy(bool isDevelopment) : IOriginPolicy
{
    private const string ProductionOrigin = "https://nyfbi.org";
    private const string DevelopmentOrigin = "https://localhost:5173";

    public bool IsAllowed(string? origin) =>
        string.Equals(origin, ProductionOrigin, StringComparison.Ordinal) ||
        (isDevelopment && string.Equals(origin, DevelopmentOrigin, StringComparison.Ordinal));
}

public static class LoopbackBindingPolicy
{
    public static bool IsAllowed(Uri endpoint)
    {
        if (!string.Equals(endpoint.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
            return false;
        return IPAddress.TryParse(endpoint.Host, out var address) && IPAddress.IsLoopback(address);
    }
}
