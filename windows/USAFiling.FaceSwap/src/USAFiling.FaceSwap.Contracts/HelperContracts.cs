using System.Text.Json.Serialization;

namespace USAFiling.FaceSwap.Contracts;

public static class ApiVersion
{
    public const string Current = "1";
}

public static class HelperErrorCodes
{
    public const string HelperNotReady = "HELPER_NOT_READY";
    public const string InvalidSession = "INVALID_SESSION";
    public const string EngineUnavailable = "ENGINE_UNAVAILABLE";
    public const string CameraUnavailable = "CAMERA_UNAVAILABLE";
}

public sealed record HelperStatus(
    string ApiVersion,
    string HelperVersion,
    bool EngineReady,
    bool VirtualCameraReady,
    string ProcessingState);

public sealed record CreateSessionRequest(
    string Assertion,
    string HelperNonce,
    string DeviceId);

public sealed record CreateSessionResponse(
    string SessionId,
    long ExpiresAt);

public sealed record EnrollFaceResult(
    bool Enrolled,
    int FaceCount,
    HelperError? Error);

public sealed record StartProcessingRequest(string CameraId);

public sealed record ProcessingStatus(
    string State,
    int FramesPerSecond,
    HelperError? Error);

public sealed record HelperError(
    string Code,
    string Message,
    bool Recoverable);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(HelperStatus))]
[JsonSerializable(typeof(CreateSessionRequest))]
[JsonSerializable(typeof(CreateSessionResponse))]
[JsonSerializable(typeof(EnrollFaceResult))]
[JsonSerializable(typeof(StartProcessingRequest))]
[JsonSerializable(typeof(ProcessingStatus))]
[JsonSerializable(typeof(HelperError))]
public partial class HelperJsonContext : JsonSerializerContext;
