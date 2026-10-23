using USAFiling.FaceSwap.Contracts;
using USAFiling.FaceSwap.Helper.Gateway;

var builder = WebApplication.CreateBuilder(args);
var listenUrl = builder.Configuration["Helper:ListenUrl"] ?? "https://127.0.0.1:43821";
if (!Uri.TryCreate(listenUrl, UriKind.Absolute, out var listenEndpoint) ||
    !LoopbackBindingPolicy.IsAllowed(listenEndpoint))
    throw new InvalidOperationException("The helper must bind to an HTTPS loopback endpoint.");
builder.WebHost.UseUrls(listenUrl);
builder.Services.AddSingleton<IOriginPolicy>(
    new OriginPolicy(builder.Environment.IsDevelopment()));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<ISessionRegistry, SessionRegistry>();
builder.Services.AddHttpClient<IBackendAssertionValidator, BackendAssertionValidator>();
var app = builder.Build();

app.UseExactOriginCors();
app.MapHelperEndpoints();

app.Run();
