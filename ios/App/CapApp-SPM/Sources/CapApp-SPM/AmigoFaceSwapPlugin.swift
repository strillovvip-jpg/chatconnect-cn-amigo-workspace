import Foundation
import Capacitor
import UIKit
import CoreImage
import CoreVideo
import AmigoFaceSwapSDK
import LiveKit

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
        CAPPluginMethod(name: "getNativeRoomStatus", returnType: CAPPluginReturnPromise)
    ]

    private var targetLatent: FaceLatent?
    private var didInitialize = false
    private let processingQueue = DispatchQueue(label: "amigo.faceswap.processing", qos: .userInitiated)
    private let nativeSession = NativeLiveKitSession()

    @objc override public func load() {
        CAPLog.print("[AmigoFaceSwapPlugin] loaded into Capacitor bridge")
        let apiKey = getConfig().getString("apiKey")
        if let apiKey, !apiKey.isEmpty {
            CAPLog.print("[AmigoFaceSwapPlugin] bootstrapping SDK from capacitor config")
            initializeSDK(apiKey: apiKey)
        } else {
            CAPLog.print("[AmigoFaceSwapPlugin] no apiKey in capacitor config, waiting for JS initialize() call")
        }
    }

    private func initializeSDK(apiKey: String) {
        processingQueue.async {
            let semaphore = DispatchSemaphore(value: 0)
            var failure: Error?
            Task {
                do {
                    try await AmigoFaceSwap.initialize(apiKey: apiKey, onProgress: nil)
                    self.didInitialize = true
                    CAPLog.print("[AmigoFaceSwapPlugin] SDK initialize success")
                } catch {
                    self.didInitialize = false
                    failure = error
                }
                semaphore.signal()
            }
            let waitResult = semaphore.wait(timeout: .now() + 120)
            if waitResult == DispatchTimeoutResult.timedOut {
                self.didInitialize = false
                CAPLog.print("[AmigoFaceSwapPlugin] SDK initialize timed out")
            } else if let failure {
                self.logNativeError(stage: "initialize", error: failure)
            }
        }
    }

    @objc func initialize(_ call: CAPPluginCall) {
        let apiKey = call.getString("apiKey") ?? getConfig().getString("apiKey") ?? ""
        guard !apiKey.isEmpty else {
            CAPLog.print("[AmigoFaceSwapPlugin] initialize rejected: missing apiKey")
            reject(
                call,
                stage: "initialize",
                code: "SDK_API_KEY_MISSING",
                message: "The native image processor key is missing."
            )
            return
        }
        processingQueue.async {
            let semaphore = DispatchSemaphore(value: 0)
            var failure: Error?
            Task {
                do {
                    try await AmigoFaceSwap.initialize(apiKey: apiKey, onProgress: nil)
                    self.didInitialize = true
                    CAPLog.print("[AmigoFaceSwapPlugin] initialize() resolved successfully")
                } catch {
                    self.didInitialize = false
                    failure = error
                }
                semaphore.signal()
            }
            let waitResult = semaphore.wait(timeout: .now() + 120)
            if waitResult == DispatchTimeoutResult.timedOut {
                self.didInitialize = false
                self.reject(
                    call,
                    stage: "initialize",
                    code: "SDK_INITIALIZATION_FAILED",
                    message: "Native image processor initialization timed out."
                )
                return
            }
            if let failure {
                self.rejectSDKError(call, stage: "initialize", error: failure)
            } else {
                call.resolve(["initialized": true])
            }
        }
    }

    @objc func enrollFace(_ call: CAPPluginCall) {
        guard didInitialize else {
            CAPLog.print("[AmigoFaceSwapPlugin] enrollFace rejected: SDK not initialized")
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
        CAPLog.print(
            "[AmigoFaceSwapPlugin] enrollFace decoded image bytes=\(data.count) size=\(imageWidth)x\(imageHeight) orientation=\(decodedImage.imageOrientation.rawValue)"
        )
        processingQueue.async {
            let semaphore = DispatchSemaphore(value: 0)
            var latent: FaceLatent?
            var failure: Error?
            Task {
                do {
                    // Match the official Amigo sample exactly: decode the
                    // selected bytes to UIImage and pass that UIImage directly
                    // to enrollFace without redrawing, cropping or recompressing.
                    latent = try await AmigoFaceSwap.enrollFace(from: decodedImage)
                } catch {
                    failure = error
                }
                semaphore.signal()
            }
            let waitResult = semaphore.wait(timeout: .now() + 60)
            if waitResult == DispatchTimeoutResult.timedOut {
                self.reject(
                    call,
                    stage: "enroll",
                    code: "FACE_ENROLL_TIMEOUT",
                    message: "Enrolling the selected face timed out.",
                    details: imageDetails
                )
                return
            }
            if let failure {
                self.rejectSDKError(
                    call,
                    stage: "enroll",
                    error: failure,
                    details: imageDetails
                )
                return
            }
            guard let latent else {
                self.reject(
                    call,
                    stage: "enroll",
                    code: "FACE_ENROLL_FAILED",
                    message: "The native image processor returned no enrolled face.",
                    details: imageDetails
                )
                return
            }
            self.targetLatent = latent
            self.nativeSession.setTargetLatent(latent)
            CAPLog.print("[AmigoFaceSwapPlugin] enrollFace success: latent cached")
            var success = imageDetails
            success["enrolled"] = true
            call.resolve(success)
        }
    }

    @objc func processFrame(_ call: CAPPluginCall) {
        guard didInitialize else {
            CAPLog.print("[AmigoFaceSwapPlugin] processFrame skipped: SDK not initialized")
            call.resolve(["swapped": false, "imageData": NSNull()])
            return
        }
        guard let latent = targetLatent else {
            CAPLog.print("[AmigoFaceSwapPlugin] processFrame skipped: no enrolled face")
            call.resolve(["swapped": false, "imageData": NSNull()])
            return
        }
        guard let base64 = call.getString("imageData"),
              let data = Data(base64Encoded: base64),
              let image = UIImage(data: data),
              let pixelBuffer = Self.pixelBuffer(from: image) else {
            CAPLog.print("[AmigoFaceSwapPlugin] processFrame skipped: invalid input frame")
            call.resolve(["swapped": false, "imageData": NSNull()])
            return
        }
        processingQueue.async {
            do {
                guard let output = try AmigoFaceSwap.processFrame(pixelBuffer, using: latent, lipMode: .innerLips),
                      let outputImage = Self.rasterized(output),
                      let jpeg = outputImage.jpegData(compressionQuality: 0.85) else {
                    CAPLog.print("[AmigoFaceSwapPlugin] processFrame returned no swapped frame")
                    call.resolve(["swapped": false, "imageData": NSNull()])
                    return
                }
                call.resolve(["swapped": true, "imageData": jpeg.base64EncodedString()])
            } catch {
                CAPLog.print("[AmigoFaceSwapPlugin] processFrame failed: \(error.localizedDescription)")
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
            diagnostic["sdkDebugDescription"] = String(reflecting: error)
            logNativeError(stage: stage, error: error, mappedCode: code)
        } else {
            CAPLog.print("[AmigoFaceSwapPlugin] stage=\(stage) code=\(code) message=\(message)")
        }
        call.reject(message, code, error, diagnostic)
    }

    private func logNativeError(stage: String, error: Error, mappedCode: String? = nil) {
        let nativeError = error as NSError
        CAPLog.print(
            "[AmigoFaceSwapPlugin] stage=\(stage) code=\(mappedCode ?? "UNMAPPED") " +
            "domain=\(nativeError.domain) nativeCode=\(nativeError.code) " +
            "message=\(nativeError.localizedDescription) debug=\(String(reflecting: error))"
        )
    }

    private static func mappedSDKError(_ error: Error, stage: String) -> (code: String, message: String) {
        guard let sdkError = error as? AmigoError else {
            return (
                stage == "initialize" ? "SDK_INITIALIZATION_FAILED" : "FACE_ENROLL_FAILED",
                error.localizedDescription
            )
        }
        switch sdkError {
        case .notInitialized:
            return ("SDK_NOT_INITIALIZED", "The native image processor has not been initialized.")
        case .invalidAPIKey(_), .revokedAPIKey:
            return ("SDK_AUTHORIZATION_FAILED", "Native image processor authorization failed.")
        case .noFaceDetected:
            return ("FACE_NOT_DETECTED", "No usable face was detected in the selected image.")
        case .invalidInput(let reason):
            return ("FACE_IMAGE_FORMAT_UNSUPPORTED", reason)
        case .networkRequired:
            return ("SDK_NETWORK_REQUIRED", "A network connection is required to prepare native image processing.")
        case .quotaExceeded(let limit, let used):
            return ("SDK_QUOTA_EXCEEDED", "Native image processing quota exceeded (\(used)/\(limit)).")
        case .modelDownloadFailed(let reason), .serverError(let reason):
            return ("SDK_NETWORK_REQUIRED", reason)
        case .modelLoadFailed, .modelDecryptionFailed:
            return ("SDK_INITIALIZATION_FAILED", sdkError.localizedDescription)
        case .inferenceFailure(let reason):
            return ("FACE_ENROLL_FAILED", reason)
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

private final class AmigoRealtimeVideoProcessor: NSObject, VideoProcessor {
    private let stateLock = NSLock()
    private let ciContext = CIContext(options: nil)
    private var targetLatent: FaceLatent?
    private var faceSwapEnabled = false
    private var cachedPixelBuffer: CVPixelBuffer?
    private var cachedBufferSize: CGSize?

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
            return frame
        }

        do {
            guard let outputImage = try AmigoFaceSwap.processFrame(
                inputBuffer,
                using: latent,
                lipMode: .innerLips
            ) else {
                return frame
            }
            let size = CGSize(
                width: Int(frame.dimensions.width),
                height: Int(frame.dimensions.height)
            )
            guard let outputBuffer = getOutputBuffer(for: size) else {
                return frame
            }
            ciContext.render(outputImage, to: outputBuffer)
            return VideoFrame(
                dimensions: frame.dimensions,
                rotation: frame.rotation,
                timeStampNs: frame.timeStampNs,
                buffer: CVPixelVideoBuffer(pixelBuffer: outputBuffer)
            )
        } catch {
            CAPLog.print("[AmigoRealtimeVideoProcessor] process failed: \(error.localizedDescription)")
            return frame
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
