using USAFiling.FaceSwap.Contracts;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

app.MapGet(
    "/v1/status",
    () => Results.Json(
        new HelperStatus(ApiVersion.Current, "0.1.0", false, false, "idle"),
        HelperJsonContext.Default.HelperStatus));

app.Run();
