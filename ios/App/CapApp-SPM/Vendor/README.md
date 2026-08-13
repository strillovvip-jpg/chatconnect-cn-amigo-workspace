This project vendors the official Amigo iOS SDK so Xcode Cloud can build from a
clean Git checkout. The pinned upstream archive is **v1.0.2**, downloaded from:

`https://downloads.amigoai.io/swiftpm/AmigoSDK_iOS/v1.0.2/AmigoFaceSwapSDK.xcframework.zip`

The official SwiftPM checksum is:

`13cc7fe8bb00221298dc8ae478aa64a7a138d327f655731709145fb246a9261b`

The framework's own `CFBundleShortVersionString` is currently `1.0.0` even in
that upstream v1.0.2 archive. `AMIGO_SDK_RELEASE` records the verified archive
release and checksum rather than relying on that vendor metadata.

Verify the bundled framework after changes:

```bash
scripts/verify-amigo-sdk-version.sh
```
