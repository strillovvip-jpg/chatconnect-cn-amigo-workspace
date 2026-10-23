using System.Text.Json;
using USAFiling.FaceSwap.Contracts;

namespace USAFiling.FaceSwap.Contracts.Tests;

public sealed class ContractTests
{
    private static string[] PropertyNames<T>(T value) where T : notnull
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(value, HelperJsonContext.Default.Options));
        return document.RootElement.EnumerateObject().Select(property => property.Name).ToArray();
    }

    [Fact]
    public void Status_serialization_exposes_only_non_biometric_health_fields()
    {
        var status = new HelperStatus("1", "0.1.0", false, false, "idle");

        Assert.Equal(
            ["apiVersion", "helperVersion", "engineReady", "virtualCameraReady", "processingState"],
            PropertyNames(status));

        var json = JsonSerializer.Serialize(status, HelperJsonContext.Default.Options);
        Assert.DoesNotContain("image", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("frame", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("embedding", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Session_contracts_keep_assertion_nonce_and_expiry_names_stable()
    {
        Assert.Equal(
            ["assertion", "helperNonce", "deviceId"],
            PropertyNames(new CreateSessionRequest("secret", "nonce", "device")));
        Assert.Equal(
            ["sessionId", "expiresAt"],
            PropertyNames(new CreateSessionResponse("session", 1_800_000_000_000)));
    }

    [Fact]
    public void Enrollment_contract_reports_result_without_returning_face_data()
    {
        var result = new EnrollFaceResult(true, 1, null);

        Assert.Equal(["enrolled", "faceCount", "error"], PropertyNames(result));
        var json = JsonSerializer.Serialize(result, HelperJsonContext.Default.Options);
        Assert.DoesNotContain("image", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("embedding", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Processing_contracts_keep_start_stop_and_delete_status_shape_stable()
    {
        Assert.Equal(["cameraId"], PropertyNames(new StartProcessingRequest("camera-1")));

        var status = new ProcessingStatus("processing", 24, null);
        Assert.Equal(["state", "framesPerSecond", "error"], PropertyNames(status));

        var stopped = new ProcessingStatus("stopped", 0, null);
        var deleted = new ProcessingStatus("face-cleared", 0, null);
        Assert.Equal(PropertyNames(status), PropertyNames(stopped));
        Assert.Equal(PropertyNames(status), PropertyNames(deleted));
    }

    [Fact]
    public void Error_codes_are_stable_wire_values()
    {
        Assert.Equal("HELPER_NOT_READY", HelperErrorCodes.HelperNotReady);
        Assert.Equal("INVALID_SESSION", HelperErrorCodes.InvalidSession);
        Assert.Equal("ENGINE_UNAVAILABLE", HelperErrorCodes.EngineUnavailable);
        Assert.Equal("CAMERA_UNAVAILABLE", HelperErrorCodes.CameraUnavailable);
        Assert.Equal(
            ["code", "message", "recoverable"],
            PropertyNames(new HelperError(HelperErrorCodes.HelperNotReady, "Not ready", true)));
    }

    [Fact]
    public void Api_version_is_v1()
    {
        Assert.Equal("1", ApiVersion.Current);
    }
}
