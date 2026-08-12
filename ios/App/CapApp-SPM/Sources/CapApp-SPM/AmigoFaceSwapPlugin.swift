import Foundation
import Capacitor
import UIKit
import AVFoundation
import CoreImage
import CoreVideo
import AmigoFaceSwapSDK
import LiveKit

private enum AmigoSDKDiagnostics {
    private static let lock = NSLock()
    private static let formatter = ISO8601DateFormatter()
    private static let fileName = "amigo-sdk-diagnostics.log"

    static func record(_ message: String) {
        let line = "\(formatter.string(from: Date())) \(message)\n"
        CAPLog.print(line.trimmingCharacters(in: .newlines))
        fputs(line, stderr)

        lock.lock()
        defer { lock.unlock() }
        do {
            let fileManager = FileManager.default
            let documents = try fileManager.url(
                for: .documentDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            let url = documents.appendingPathComponent(fileName)
            let data = Data(line.utf8)
            if !fileManager.fileExists(atPath: url.path) {
                try data.write(to: url, options: .atomic)
                return
            }
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: data)
        } catch {
            CAPLog.print("[AmigoSDKDiagnostics] file write failed: \(error)")
        }
    }

    static func recordError(stage: String, error: Error, mappedCode: String? = nil) {
        let nativeError = error as NSError
        let resolvedCode = mappedCode ?? "UNMAPPED"
        record(
            "[AmigoSDK] stage=\(stage) result=error mappedCode=\(resolvedCode) " +
            "sdkCase=\(AmigoFaceSwapPlugin.officialSDKCase(error)) " +
            "domain=\(nativeError.domain) nativeCode=\(nativeError.code) " +
            "message=\(nativeError.localizedDescription) debug=\(String(reflecting: error))"
        )
    }
}

/**
 * Native bridge for the Amigo Face Swap iOS SDK.
 *
 * Web side (AISource in `src/lib/video-sources/sources.ts`) sends JPEG frames
 * captured from the LiveKit camera track. Each frame is converted to a
 * CVPixelBuffer, processed synchronously by `AmigoFaceSwap.processFrame`, and
 * the swapped result is returned as JPEG data for re-encoding into the
 * existing WebRTC pipeline.
 *
 * This plugin also hosts the first native LiveKit session hooks so the app can
 * move the realtime call pipeline out of the WebView and into iOS.
 */
@objc(AmigoFaceSwapPlugin)
public class AmigoFaceSwapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AmigoFaceSwapPlugin"
    public let jsName = "AmigoFaceSwap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enrollFace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "processFrame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearModelCache", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPipelineCapabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connectNativeRoom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnectNativeRoom", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNativeFaceSwapEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNativeRoomStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestMediaPermissions", returnType: CAPPluginReturnPromise)
    ]

    private var targetLatent: FaceLatent?
    private var didInitialize = false
    private var didLogFirstProcessedFrame = false
    #if DEBUG
    private var liveFrameVerifier: AmigoLiveFrameVerifier?
    #endif
    private let processingQueue = DispatchQueue(label: "amigo.faceswap.processing", qos: .userInitiated)
    private let nativeSession = NativeLiveKitSession()

    @objc override public func load() {
        AmigoSDKDiagnostics.record("[AmigoSDK] stage=pluginLoad result=success")
        let apiKey = getConfig().getString("apiKey")
        if let apiKey, !apiKey.isEmpty {
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=initialize source=capacitorConfig result=started")
            initializeSDK(apiKey: apiKey)
        } else {
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=initialize source=javascript result=waiting")
        }
    }

    private func initializeSDK(apiKey: String) {
        Task { [weak self] in
            guard let self else { return }
            do {
                try await AmigoFaceSwap.initialize(apiKey: apiKey) { progress in
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=initialize source=capacitorConfig result=progress value=\(progress)"
                    )
                }
                self.didInitialize = true
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=initialize source=capacitorConfig result=success initialized=true"
                )
            } catch {
                self.didInitialize = false
                let mapped = Self.mappedSDKError(error, stage: "initialize")
                self.logNativeError(stage: "initialize", error: error, mappedCode: mapped.code)
            }
        }
    }

    @objc func initialize(_ call: CAPPluginCall) {
        if didInitialize {
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=initialize source=javascript result=success initialized=true reused=true")
            call.resolve(["initialized": true, "reused": true])
            return
        }
        let apiKey = call.getString("apiKey") ?? getConfig().getString("apiKey") ?? ""
        guard !apiKey.isEmpty else {
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=initialize source=javascript result=error mappedCode=SDK_API_KEY_MISSING")
            reject(
                call,
                stage: "initialize",
                code: "SDK_API_KEY_MISSING",
                message: "The native image processor key is missing."
            )
            return
        }
        Task { [weak self] in
            guard let self else {
                call.reject("The native image processor plugin was released.", "SDK_PLUGIN_RELEASED")
                return
            }
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=initialize source=javascript result=started")
            do {
                try await AmigoFaceSwap.initialize(apiKey: apiKey) { progress in
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=initialize source=javascript result=progress value=\(progress)"
                    )
                }
                self.didInitialize = true
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=initialize source=javascript result=success initialized=true"
                )
                call.resolve(["initialized": true])
            } catch {
                self.didInitialize = false
                self.rejectSDKError(call, stage: "initialize", error: error)
            }
        }
    }

    @objc func enrollFace(_ call: CAPPluginCall) {
        guard didInitialize else {
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=enrollFace result=error mappedCode=SDK_NOT_INITIALIZED")
            reject(
                call,
                stage: "enroll",
                code: "SDK_NOT_INITIALIZED",
                message: "The native image processor has not been initialized."
            )
            return
        }
        guard let payload = call.getString("imageData"), !payload.isEmpty else {
            reject(
                call,
                stage: "decode",
                code: "FACE_IMAGE_EMPTY",
                message: "The selected image contains no readable bytes."
            )
            return
        }
        let base64 = Self.base64Payload(from: payload)
        guard let data = Data(base64Encoded: base64, options: [.ignoreUnknownCharacters]), !data.isEmpty else {
            reject(
                call,
                stage: "decode",
                code: "FACE_IMAGE_DECODE_FAILED",
                message: "The selected image could not be decoded from its transferred data."
            )
            return
        }
        guard let decodedImage = UIImage(data: data) else {
            reject(
                call,
                stage: "decode",
                code: "FACE_IMAGE_DECODE_FAILED",
                message: "The selected image is not a decodable JPEG or PNG image.",
                details: ["imageByteLength": data.count]
            )
            return
        }
        let imageWidth = decodedImage.cgImage?.width ?? Int(decodedImage.size.width * decodedImage.scale)
        let imageHeight = decodedImage.cgImage?.height ?? Int(decodedImage.size.height * decodedImage.scale)
        let imageDetails: PluginCallResultData = [
            "imageByteLength": data.count,
            "imageWidth": imageWidth,
            "imageHeight": imageHeight,
            "imageOrientation": decodedImage.imageOrientation.rawValue
        ]
        AmigoSDKDiagnostics.record(
            "[AmigoSDK] stage=imageDecode result=success bytes=\(data.count) size=\(imageWidth)x\(imageHeight) orientation=\(decodedImage.imageOrientation.rawValue)"
        )
        Task { [weak self] in
            guard let self else {
                call.reject("The native image processor plugin was released.", "SDK_PLUGIN_RELEASED")
                return
            }
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=enrollFace result=started")
            let latent: FaceLatent
            do {
                // Match the official Amigo sample exactly: decode the selected
                // bytes to UIImage and await enrollFace directly. Do not block
                // the SDK's async model download/inference work with a semaphore.
                latent = try await AmigoFaceSwap.enrollFace(from: decodedImage)
            } catch {
                self.rejectSDKError(
                    call,
                    stage: "enroll",
                    error: error,
                    details: imageDetails
                )
                return
            }
            self.targetLatent = latent
            self.nativeSession.setTargetLatent(latent)
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=enrollFace result=success faceLatentReceived=true " +
                "latentType=\(String(reflecting: type(of: latent))) latentHash=\(latent.hashValue) " +
                "targetLatentStored=true nativeSessionUpdated=true"
            )
            var success = imageDetails
            success["enrolled"] = true
            success["latentHash"] = latent.hashValue
            call.resolve(success)

            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--amigo-verify-live-frame") {
                do {
                    guard let verificationBuffer = Self.pixelBuffer(from: decodedImage) else {
                        AmigoSDKDiagnostics.record(
                            "[AmigoSDK] stage=processFrameVerification result=error mappedCode=SDK_INVALID_INPUT"
                        )
                        return
                    }
                    let verificationResult = try AmigoFaceSwap.processFrame(
                        verificationBuffer,
                        using: latent,
                        lipMode: .innerLips
                    )
                    let verificationResultName = verificationResult == nil ? "nil" : "success"
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=processFrameVerification result=\(verificationResultName) " +
                        "source=enrolledImage usingCachedLatent=true latentHash=\(latent.hashValue)"
                    )
                } catch {
                    let mapped = Self.mappedSDKError(error, stage: "processFrameVerification")
                    AmigoSDKDiagnostics.recordError(
                        stage: "processFrameVerification",
                        error: error,
                        mappedCode: mapped.code
                    )
                }
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=liveFrameVerification result=started latentHash=\(latent.hashValue)"
                )
                let verifier = AmigoLiveFrameVerifier(latent: latent)
                self.liveFrameVerifier = verifier
                verifier.start()
            }
            #endif
        }
    }

    @objc func processFrame(_ call: CAPPluginCall) {
        guard didInitialize else {
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=processFrame result=error mappedCode=SDK_NOT_INITIALIZED")
            call.resolve(["swapped": false, "imageData": NSNull()])
            return
        }
        guard let latent = targetLatent else {
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=processFrame result=error mappedCode=NATIVE_FACE_STATE_MISSING")
            call.resolve(["swapped": false, "imageData": NSNull()])
            return
        }
        guard let base64 = call.getString("imageData"),
              let data = Data(base64Encoded: base64),
              let image = UIImage(data: data),
              let pixelBuffer = Self.pixelBuffer(from: image) else {
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=processFrame result=error mappedCode=SDK_INVALID_INPUT")
            call.resolve(["swapped": false, "imageData": NSNull()])
            return
        }
        processingQueue.async {
            do {
                guard let output = try AmigoFaceSwap.processFrame(pixelBuffer, using: latent, lipMode: .innerLips),
                      let outputImage = Self.rasterized(output),
                      let jpeg = outputImage.jpegData(compressionQuality: 0.85) else {
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=processFrame result=nil latentHash=\(latent.hashValue)"
                    )
                    call.resolve(["swapped": false, "imageData": NSNull()])
                    return
                }
                if !self.didLogFirstProcessedFrame {
                    self.didLogFirstProcessedFrame = true
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=processFrame result=success usingCachedLatent=true " +
                        "latentHash=\(latent.hashValue) extent=\(output.extent.width)x\(output.extent.height)"
                    )
                }
                call.resolve(["swapped": true, "imageData": jpeg.base64EncodedString()])
            } catch {
                let mapped = Self.mappedSDKError(error, stage: "processFrame")
                self.logNativeError(stage: "processFrame", error: error, mappedCode: mapped.code)
                call.resolve(["swapped": false, "imageData": NSNull()])
            }
        }
    }

    @objc func clearModelCache(_ call: CAPPluginCall) {
        CAPLog.print("[AmigoFaceSwapPlugin] clearModelCache invoked")
        AmigoFaceSwap.clearModelCache()
        targetLatent = nil
        nativeSession.setTargetLatent(nil)
        call.resolve()
    }

    @objc func getPipelineCapabilities(_ call: CAPPluginCall) {
        call.resolve([
            "nativeRealtimeLiveKit": true,
            "legacyBridgeJpeg": true,
            "platform": "ios"
        ])
    }

    @objc func connectNativeRoom(_ call: CAPPluginCall) {
        guard didInitialize else {
            call.reject("Amigo SDK has not been initialized.")
            return
        }
        let url = call.getString("url") ?? ""
        let token = call.getString("token") ?? ""
        let enableMicrophone = call.getBool("enableMicrophone") ?? true
        let enableCamera = call.getBool("enableCamera") ?? true
        guard !url.isEmpty, !token.isEmpty else {
            call.reject("connectNativeRoom requires both 'url' and 'token'.")
            return
        }
        processingQueue.async {
            self.nativeSession.connect(
                url: url,
                token: token,
                enableMicrophone: enableMicrophone,
                enableCamera: enableCamera
            ) { error in
                if let error {
                    CAPLog.print("[AmigoFaceSwapPlugin] connectNativeRoom failed: \(error)")
                    call.reject(error)
                } else {
                    call.resolve(self.nativeSession.status())
                }
            }
        }
    }

    @objc func disconnectNativeRoom(_ call: CAPPluginCall) {
        processingQueue.async {
            self.nativeSession.disconnect()
            call.resolve(self.nativeSession.status())
        }
    }

    @objc func setNativeFaceSwapEnabled(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        processingQueue.async {
            self.nativeSession.setFaceSwapEnabled(enabled)
            call.resolve(self.nativeSession.status())
        }
    }

    @objc func getNativeRoomStatus(_ call: CAPPluginCall) {
        processingQueue.async {
            call.resolve(self.nativeSession.status())
        }
    }

    @objc func requestMediaPermissions(_ call: CAPPluginCall) {
        let openSettingsIfDenied = call.getBool("openSettingsIfDenied") ?? false
        DispatchQueue.main.async {
            self.resolveCameraPermission { camera in
                self.resolveMicrophonePermission { microphone in
                    DispatchQueue.main.async {
                        AmigoSDKDiagnostics.record(
                            "[MediaPermissions] camera=\(camera) microphone=\(microphone)"
                        )
                        if openSettingsIfDenied &&
                            (camera == "denied" || camera == "restricted" ||
                             microphone == "denied" || microphone == "restricted"),
                           let settingsURL = URL(string: UIApplication.openSettingsURLString),
                           UIApplication.shared.canOpenURL(settingsURL) {
                            UIApplication.shared.open(settingsURL)
                        }
                        call.resolve([
                            "camera": camera,
                            "microphone": microphone
                        ])
                    }
                }
            }
        }
    }

    private func resolveCameraPermission(completion: @escaping (String) -> Void) {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        guard status == .notDetermined else {
            completion(Self.cameraPermissionName(status))
            return
        }
        AVCaptureDevice.requestAccess(for: .video) { granted in
            completion(granted ? "authorized" : Self.cameraPermissionName(
                AVCaptureDevice.authorizationStatus(for: .video)
            ))
        }
    }

    private func resolveMicrophonePermission(completion: @escaping (String) -> Void) {
        let session = AVAudioSession.sharedInstance()
        guard session.recordPermission == .undetermined else {
            completion(Self.microphonePermissionName(session.recordPermission))
            return
        }
        session.requestRecordPermission { granted in
            completion(granted ? "authorized" : Self.microphonePermissionName(
                AVAudioSession.sharedInstance().recordPermission
            ))
        }
    }

    private static func cameraPermissionName(
        _ status: AVAuthorizationStatus
    ) -> String {
        switch status {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorized: return "authorized"
        @unknown default: return "unknown"
        }
    }

    private static func microphonePermissionName(
        _ status: AVAudioSession.RecordPermission
    ) -> String {
        switch status {
        case .undetermined: return "notDetermined"
        case .denied: return "denied"
        case .granted: return "authorized"
        @unknown default: return "unknown"
        }
    }

    private func rejectSDKError(
        _ call: CAPPluginCall,
        stage: String,
        error: Error,
        details: PluginCallResultData = [:]
    ) {
        let mapped = Self.mappedSDKError(error, stage: stage)
        reject(
            call,
            stage: stage,
            code: mapped.code,
            message: mapped.message,
            error: error,
            details: details
        )
    }

    private func reject(
        _ call: CAPPluginCall,
        stage: String,
        code: String,
        message: String,
        error: Error? = nil,
        details: PluginCallResultData = [:]
    ) {
        var diagnostic = details
        diagnostic["stage"] = stage
        diagnostic["code"] = code
        if let error {
            let nativeError = error as NSError
            diagnostic["sdkDomain"] = nativeError.domain
            diagnostic["sdkCode"] = nativeError.code
            diagnostic["sdkMessage"] = nativeError.localizedDescription
            diagnostic["sdkCase"] = Self.officialSDKCase(error)
            diagnostic["sdkDebugDescription"] = String(reflecting: error)
            logNativeError(stage: stage, error: error, mappedCode: code)
        } else {
            CAPLog.print("[AmigoFaceSwapPlugin] stage=\(stage) code=\(code) message=\(message)")
        }
        call.reject(message, code, error, diagnostic)
    }

    private func logNativeError(stage: String, error: Error, mappedCode: String? = nil) {
        AmigoSDKDiagnostics.recordError(stage: stage, error: error, mappedCode: mappedCode)
    }

    fileprivate static func officialSDKCase(_ error: Error) -> String {
        guard let sdkError = error as? AmigoError else { return "nonAmigoError" }
        switch sdkError {
        case .notInitialized: return "notInitialized"
        case .invalidAPIKey: return "invalidAPIKey"
        case .revokedAPIKey: return "revokedAPIKey"
        case .quotaExceeded: return "quotaExceeded"
        case .noFaceDetected: return "noFaceDetected"
        case .modelLoadFailed: return "modelLoadFailed"
        case .modelDownloadFailed: return "modelDownloadFailed"
        case .modelDecryptionFailed: return "modelDecryptionFailed"
        case .networkRequired: return "networkRequired"
        case .serverError: return "serverError"
        case .inferenceFailure: return "inferenceFailure"
        case .invalidInput: return "invalidInput"
        @unknown default: return "unknown"
        }
    }

    fileprivate static func mappedSDKError(_ error: Error, stage: String) -> (code: String, message: String) {
        guard let sdkError = error as? AmigoError else {
            return (
                stage == "initialize" ? "SDK_INITIALIZATION_FAILED" : "FACE_ENROLL_FAILED",
                error.localizedDescription
            )
        }
        switch sdkError {
        case .notInitialized:
            return ("SDK_NOT_INITIALIZED", "The native image processor has not been initialized.")
        case .invalidAPIKey(let reason):
            return ("SDK_INVALID_API_KEY", reason)
        case .revokedAPIKey:
            return ("SDK_REVOKED_API_KEY", sdkError.localizedDescription)
        case .noFaceDetected:
            return ("FACE_NOT_DETECTED", "No usable face was detected in the selected image.")
        case .invalidInput(let reason):
            return ("SDK_INVALID_INPUT", reason)
        case .networkRequired:
            return ("SDK_NETWORK_REQUIRED", "A network connection is required to prepare native image processing.")
        case .quotaExceeded(let limit, let used):
            return ("SDK_QUOTA_EXCEEDED", "Native image processing quota exceeded (\(used)/\(limit)).")
        case .modelDownloadFailed(let reason):
            return ("SDK_MODEL_DOWNLOAD_FAILED", reason)
        case .serverError(let reason):
            return ("SDK_SERVER_ERROR", reason)
        case .modelLoadFailed:
            return ("SDK_MODEL_LOAD_FAILED", sdkError.localizedDescription)
        case .modelDecryptionFailed:
            return ("SDK_MODEL_DECRYPTION_FAILED", sdkError.localizedDescription)
        case .inferenceFailure(let reason):
            return ("SDK_INFERENCE_FAILURE", reason)
        @unknown default:
            return (
                stage == "initialize" ? "SDK_INITIALIZATION_FAILED" : "FACE_ENROLL_FAILED",
                sdkError.localizedDescription
            )
        }
    }

    private static func base64Payload(from value: String) -> String {
        guard value.hasPrefix("data:"), let separator = value.firstIndex(of: ",") else {
            return value
        }
        return String(value[value.index(after: separator)...])
    }

    private static func pixelBuffer(from image: UIImage) -> CVPixelBuffer? {
        let width = Int(image.size.width)
        let height = Int(image.size.height)
        guard width > 0, height > 0 else { return nil }
        let attributes: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true
        ]
        var pixelBuffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault, width, height,
            kCVPixelFormatType_32BGRA, attributes as CFDictionary, &pixelBuffer
        )
        guard status == kCVReturnSuccess, let buffer = pixelBuffer else { return nil }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer),
            width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ), let cgImage = image.cgImage else { return nil }
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        return buffer
    }

    private static func rasterized(_ image: CIImage) -> UIImage? {
        let context = CIContext(options: nil)
        let extent = image.extent
        guard extent.width > 0, extent.height > 0,
              let cgImage = context.createCGImage(image, from: extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

private final class NativeLiveKitSession {
    private var room: Room?
    private var roomURL: String?
    private var targetLatent: FaceLatent?
    private var faceSwapEnabled = false
    private let processor = AmigoRealtimeVideoProcessor()
    private var publishedVideoTrack: LocalVideoTrack?
    private var publishedVideoPublication: LocalTrackPublication?

    func setTargetLatent(_ latent: FaceLatent?) {
        targetLatent = latent
        processor.setTargetLatent(latent)
    }

    func setFaceSwapEnabled(_ enabled: Bool) {
        faceSwapEnabled = enabled
        processor.setEnabled(enabled)
        CAPLog.print("[NativeLiveKitSession] face swap toggled: \(enabled)")
    }

    func connect(
        url: String,
        token: String,
        enableMicrophone: Bool,
        enableCamera: Bool,
        completion: @escaping (String?) -> Void
    ) {
        if enableCamera {
            guard faceSwapEnabled, targetLatent != nil else {
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=nativeRoomConnect result=error " +
                    "mappedCode=FACE_SWAP_NOT_READY rawCameraPublished=false"
                )
                completion("FACE_SWAP_NOT_READY")
                return
            }
        }
        if room != nil {
            disconnect()
        }
        let room = Room()
        Task {
            do {
                try await room.connect(url: url, token: token)
                if enableMicrophone {
                    try await room.localParticipant.setMicrophone(enabled: true)
                }
                if enableCamera {
                    let videoTrack = LocalVideoTrack.createCameraTrack(
                        name: "amigo-face-swap",
                        options: CameraCaptureOptions(
                            position: .front,
                            dimensions: .h720_169,
                            fps: 24
                        ),
                        processor: processor
                    )
                    let publication = try await room.localParticipant.publish(videoTrack: videoTrack)
                    self.publishedVideoTrack = videoTrack
                    self.publishedVideoPublication = publication
                }
                self.room = room
                self.roomURL = url
                CAPLog.print("[NativeLiveKitSession] native room connected")
                completion(nil)
            } catch {
                self.publishedVideoPublication = nil
                self.publishedVideoTrack = nil
                CAPLog.print("[NativeLiveKitSession] native room connect failed: \(error.localizedDescription)")
                completion(error.localizedDescription)
            }
        }
    }

    func disconnect() {
        CAPLog.print("[NativeLiveKitSession] disconnecting native room")
        let activeRoom = room
        let videoPublication = publishedVideoPublication
        let videoTrack = publishedVideoTrack
        room = nil
        roomURL = nil
        publishedVideoPublication = nil
        publishedVideoTrack = nil
        Task {
            if let videoPublication {
                try? await activeRoom?.localParticipant.unpublish(publication: videoPublication)
            } else if let videoTrack {
                try? await videoTrack.stop()
            }
            await activeRoom?.disconnect()
        }
    }

    func status() -> PluginCallResultData {
        [
            "connected": room != nil,
            "roomUrl": roomURL as Any,
            "faceSwapEnabled": faceSwapEnabled,
            "hasTargetFace": targetLatent != nil,
            "pipeline": "native-livekit"
        ]
    }
}

#if DEBUG
private final class AmigoLiveFrameVerifier: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let latent: FaceLatent
    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "amigo.faceswap.live-frame-verifier")
    private var didProcessFrame = false

    init(latent: FaceLatent) {
        self.latent = latent
        super.init()
    }

    func start() {
        let authorization = AVCaptureDevice.authorizationStatus(for: .video)
        AmigoSDKDiagnostics.record(
            "[AmigoSDK] stage=liveFrameVerification cameraAuthorization=\(authorization.rawValue)"
        )
        switch authorization {
        case .authorized:
            configureAndStart()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                let permissionResult = granted ? "granted" : "denied"
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=liveFrameVerification cameraPermissionRequest=\(permissionResult)"
                )
                if granted {
                    self.configureAndStart()
                }
            }
        case .denied:
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=liveFrameVerification result=error mappedCode=CAMERA_PERMISSION_DENIED"
            )
        case .restricted:
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=liveFrameVerification result=error mappedCode=CAMERA_PERMISSION_RESTRICTED"
            )
        @unknown default:
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=liveFrameVerification result=error mappedCode=CAMERA_PERMISSION_UNKNOWN"
            )
        }
    }

    private func configureAndStart() {
        captureQueue.async {
            do {
                self.session.beginConfiguration()
                self.session.sessionPreset = .vga640x480
                guard let camera = AVCaptureDevice.default(
                    .builtInWideAngleCamera,
                    for: .video,
                    position: .front
                ) else {
                    self.session.commitConfiguration()
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=liveFrameVerification result=error mappedCode=FRONT_CAMERA_UNAVAILABLE"
                    )
                    return
                }
                let input = try AVCaptureDeviceInput(device: camera)
                guard self.session.canAddInput(input) else {
                    self.session.commitConfiguration()
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=liveFrameVerification result=error mappedCode=CAMERA_INPUT_REJECTED"
                    )
                    return
                }
                self.session.addInput(input)

                let output = AVCaptureVideoDataOutput()
                output.alwaysDiscardsLateVideoFrames = true
                output.videoSettings = [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
                ]
                output.setSampleBufferDelegate(self, queue: self.captureQueue)
                guard self.session.canAddOutput(output) else {
                    self.session.commitConfiguration()
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=liveFrameVerification result=error mappedCode=CAMERA_OUTPUT_REJECTED"
                    )
                    return
                }
                self.session.addOutput(output)
                self.session.commitConfiguration()
                self.session.startRunning()
            } catch {
                AmigoSDKDiagnostics.recordError(
                    stage: "liveFrameVerification",
                    error: error,
                    mappedCode: "CAMERA_START_FAILED"
                )
            }
        }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard !didProcessFrame, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return
        }
        didProcessFrame = true
        do {
            let result = try AmigoFaceSwap.processFrame(
                pixelBuffer,
                using: latent,
                lipMode: .innerLips
            )
            if let result {
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=liveFrameVerification result=success " +
                    "source=frontCamera usingCachedLatent=true latentHash=\(latent.hashValue) " +
                    "extent=\(result.extent.width)x\(result.extent.height)"
                )
            } else {
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=liveFrameVerification result=nil " +
                    "source=frontCamera usingCachedLatent=true latentHash=\(latent.hashValue)"
                )
            }
        } catch {
            let mapped = AmigoFaceSwapPlugin.mappedSDKError(
                error,
                stage: "liveFrameVerification"
            )
            AmigoSDKDiagnostics.recordError(
                stage: "liveFrameVerification",
                error: error,
                mappedCode: mapped.code
            )
        }
        (output as? AVCaptureVideoDataOutput)?.setSampleBufferDelegate(nil, queue: nil)
        DispatchQueue.global(qos: .utility).async {
            self.session.stopRunning()
        }
    }
}
#endif

private final class AmigoRealtimeVideoProcessor: NSObject, VideoProcessor {
    private let stateLock = NSLock()
    private let ciContext = CIContext(options: nil)
    private var targetLatent: FaceLatent?
    private var faceSwapEnabled = false
    private var cachedPixelBuffer: CVPixelBuffer?
    private var cachedBufferSize: CGSize?
    private var didLogFirstProcessedFrame = false
    private var didLogFirstNilFrame = false
    private var didLogFirstNotReadyFrame = false

    func setTargetLatent(_ latent: FaceLatent?) {
        stateLock.lock()
        targetLatent = latent
        stateLock.unlock()
    }

    func setEnabled(_ enabled: Bool) {
        stateLock.lock()
        faceSwapEnabled = enabled
        stateLock.unlock()
    }

    func process(frame: VideoFrame) -> VideoFrame? {
        stateLock.lock()
        let latent = targetLatent
        let enabled = faceSwapEnabled
        stateLock.unlock()

        guard enabled, let latent, let inputBuffer = frame.toCVPixelBuffer() else {
            if !didLogFirstNotReadyFrame {
                didLogFirstNotReadyFrame = true
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=realtimeProcessFrame result=dropped " +
                    "reason=processorNotReady rawCameraPublished=false"
                )
            }
            return nil
        }

        do {
            guard let outputImage = try AmigoFaceSwap.processFrame(
                inputBuffer,
                using: latent,
                lipMode: .innerLips
            ) else {
                if !didLogFirstNilFrame {
                    didLogFirstNilFrame = true
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=realtimeProcessFrame result=nil " +
                        "usingCachedLatent=true latentHash=\(latent.hashValue) reason=noFaceDetectedInFrame"
                    )
                }
                return nil
            }
            let size = CGSize(
                width: Int(frame.dimensions.width),
                height: Int(frame.dimensions.height)
            )
            guard let outputBuffer = getOutputBuffer(for: size) else {
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=realtimeProcessFrame result=dropped " +
                    "reason=outputBufferAllocationFailed rawCameraPublished=false"
                )
                return nil
            }
            ciContext.render(outputImage, to: outputBuffer)
            if !didLogFirstProcessedFrame {
                didLogFirstProcessedFrame = true
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=realtimeProcessFrame result=success " +
                    "usingCachedLatent=true latentHash=\(latent.hashValue) output=publishedTrack"
                )
            }
            return VideoFrame(
                dimensions: frame.dimensions,
                rotation: frame.rotation,
                timeStampNs: frame.timeStampNs,
                buffer: CVPixelVideoBuffer(pixelBuffer: outputBuffer)
            )
        } catch {
            let mapped = AmigoFaceSwapPlugin.mappedSDKError(error, stage: "processFrame")
            AmigoSDKDiagnostics.recordError(
                stage: "realtimeProcessFrame",
                error: error,
                mappedCode: mapped.code
            )
            return nil
        }
    }

    private func getOutputBuffer(for size: CGSize) -> CVPixelBuffer? {
        if cachedBufferSize != size {
            var pixelBuffer: CVPixelBuffer?
            CVPixelBufferCreate(
                kCFAllocatorDefault,
                Int(size.width),
                Int(size.height),
                kCVPixelFormatType_32BGRA,
                nil,
                &pixelBuffer
            )
            cachedPixelBuffer = pixelBuffer
            cachedBufferSize = size
        }
        return cachedPixelBuffer
    }
}
