import Foundation
import Capacitor
import UIKit
import AVFoundation
import CoreImage
import CoreVideo
import ImageIO
import Vision
import ObjectiveC.runtime
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

#if DEBUG
/// Diagnostic-only transport for the exact recognition model already fetched
/// from Amigo's signed CDN URL. Feeding it through URL loading (instead of
/// placing the encrypted file in the cache) lets the vendor SDK receive its
/// normal download-completion callback and perform its own decrypt/extract.
final class AmigoDiagnosticModelURLProtocol: URLProtocol {
    private let stateLock = NSLock()
    private var stopped = false

    override class func canInit(with request: URLRequest) -> Bool {
        guard ProcessInfo.processInfo.arguments.contains("--amigo-direct-enroll-diagnostic") else {
            return false
        }
        guard let url = request.url,
              url.scheme == "https",
              url.lastPathComponent == "w600k_r50.enc" else {
            return false
        }
        return localModelURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let sourceURL = Self.localModelURL else {
            client?.urlProtocol(self, didFailWithError: NSError(
                domain: "AmigoDiagnosticModelURLProtocol",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Local recognition model is unavailable."]
            ))
            return
        }

        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: sourceURL.path)
            let total = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            let requestedOffset = Self.rangeOffset(from: request) ?? 0
            guard requestedOffset >= 0, requestedOffset < total else {
                throw NSError(
                    domain: "AmigoDiagnosticModelURLProtocol",
                    code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Invalid model byte range."]
                )
            }

            var headers = [
                "Content-Type": "application/octet-stream",
                "Content-Length": "\(total - requestedOffset)",
                "Accept-Ranges": "bytes"
            ]
            let statusCode: Int
            if requestedOffset > 0 {
                statusCode = 206
                headers["Content-Range"] = "bytes \(requestedOffset)-\(total - 1)/\(total)"
            } else {
                statusCode = 200
            }
            guard let responseURL = request.url,
                  let response = HTTPURLResponse(
                    url: responseURL,
                    statusCode: statusCode,
                    httpVersion: "HTTP/1.1",
                    headerFields: headers
                  ) else {
                throw NSError(
                    domain: "AmigoDiagnosticModelURLProtocol",
                    code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "Unable to create model response."]
                )
            }

            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=modelDownloadIntercept result=started offset=\(requestedOffset) bytes=\(total)"
            )
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)

            let handle = try FileHandle(forReadingFrom: sourceURL)
            try handle.seek(toOffset: UInt64(requestedOffset))
            defer { try? handle.close() }
            var delivered: Int64 = 0
            while !isStopped {
                let chunk = try handle.read(upToCount: 512 * 1024) ?? Data()
                if chunk.isEmpty { break }
                client?.urlProtocol(self, didLoad: chunk)
                delivered += Int64(chunk.count)
            }
            guard !isStopped else { return }
            client?.urlProtocolDidFinishLoading(self)
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=modelDownloadIntercept result=completed delivered=\(delivered)"
            )
        } catch {
            AmigoSDKDiagnostics.recordError(stage: "modelDownloadIntercept", error: error)
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {
        stateLock.lock()
        stopped = true
        stateLock.unlock()
    }

    private var isStopped: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return stopped
    }

    private static var localModelURL: URL? {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("AmigoSDK/Models/v1.0.0/w600k_r50.enc")
    }

    private static func rangeOffset(from request: URLRequest) -> Int64? {
        guard let range = request.value(forHTTPHeaderField: "Range"),
              range.hasPrefix("bytes=") else { return nil }
        let value = range.dropFirst("bytes=".count).split(separator: "-", maxSplits: 1).first
        return value.flatMap { Int64($0) }
    }
}

/// `URLProtocol.registerClass` is not consulted by URL sessions whose
/// configuration supplies its own protocol list. The vendor downloader uses
/// such a session, so the diagnostic launch prepends the local model transport
/// to newly-created default/ephemeral configurations as well.
final class AmigoDiagnosticURLSessionConfiguration {
    private static var installed = false
    private static var retainedImplementations: [IMP] = []

    static func install() {
        guard !installed,
              ProcessInfo.processInfo.arguments.contains("--amigo-direct-enroll-diagnostic") else {
            return
        }
        installed = true
        let defaultInstalled = installFactory(selectorName: "defaultSessionConfiguration")
        let ephemeralInstalled = installFactory(selectorName: "ephemeralSessionConfiguration")
        AmigoSDKDiagnostics.record(
            "[AmigoSDK] stage=modelDownloadIntercept result=configurationInstalled " +
            "default=\(defaultInstalled) ephemeral=\(ephemeralInstalled)"
        )
    }

    private static func installFactory(selectorName: String) -> Bool {
        let selector = NSSelectorFromString(selectorName)
        guard let method = class_getClassMethod(URLSessionConfiguration.self, selector) else {
            return false
        }
        let originalIMP = method_getImplementation(method)
        typealias Original = @convention(c) (AnyClass, Selector) -> URLSessionConfiguration
        let replacement: @convention(block) (AnyClass) -> URLSessionConfiguration = { object in
            let configuration = unsafeBitCast(originalIMP, to: Original.self)(object, selector)
            var classes = configuration.protocolClasses ?? []
            if !classes.contains(where: { $0 == AmigoDiagnosticModelURLProtocol.self }) {
                classes.insert(AmigoDiagnosticModelURLProtocol.self, at: 0)
                configuration.protocolClasses = classes
            }
            return configuration
        }
        let implementation = imp_implementationWithBlock(replacement)
        retainedImplementations.append(implementation)
        method_setImplementation(method, implementation)
        return true
    }
}
#endif

/// The SDK reports model-download progress very frequently. Persisting every
/// callback blocks the download/compile path with thousands of synchronous
/// file open/write/close operations, so retain only 5% milestones.
private final class AmigoInitializationProgressLogger: @unchecked Sendable {
    private let lock = NSLock()
    private var lastBucket = -5

    func record(_ progress: Float) {
        let bucket = min(100, max(0, Int(progress * 100))) / 5 * 5
        lock.lock()
        guard bucket > lastBucket else {
            lock.unlock()
            return
        }
        lastBucket = bucket
        lock.unlock()

        AmigoSDKDiagnostics.record(
            "[AmigoSDK] stage=initialize source=javascript result=progress percent=\(bucket)"
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
    private let initializationStateLock = NSLock()
    private var initializationTask: Task<Void, Error>?
    private var didLogFirstProcessedFrame = false
    private let enrollmentStateLock = NSLock()
    private var enrollmentGeneration = 0
    #if DEBUG
    private var liveFrameVerifier: AmigoLiveFrameVerifier?
    #endif
    private let processingQueue = DispatchQueue(label: "amigo.faceswap.processing", qos: .userInitiated)
    private let nativeSession = NativeLiveKitSession()

    @objc override public func load() {
        AmigoSDKDiagnostics.record("[AmigoSDK] stage=pluginLoad result=success")
        // Do not swizzle Vision request initializers. The previous compatibility
        // hook recursively re-entered VNRequest creation on iOS 26 and crashed
        // before the vendor SDK could return its real enrollment result.
        AmigoSDKDiagnostics.record("[AmigoSDK] stage=visionCompatibility result=disabled")
        // Initialization is owned by the awaited JavaScript bridge call below.
        // Starting a second fire-and-forget initialization here races explicit
        // enrollment and can leave JS and native state disagreeing.
        AmigoSDKDiagnostics.record("[AmigoSDK] stage=initialize source=javascript result=waiting")
        #if DEBUG
        URLProtocol.registerClass(AmigoDiagnosticModelURLProtocol.self)
        AmigoDiagnosticURLSessionConfiguration.install()
        runDirectEnrollmentDiagnosticIfRequested()
        #endif
    }

    #if DEBUG
    /// Reproduce vendor enrollment directly on a connected device without any
    /// WebView state. This is excluded from Release/TestFlight and receives
    /// its API key only from the launched process environment.
    private func runDirectEnrollmentDiagnosticIfRequested() {
        let process = ProcessInfo.processInfo
        guard process.arguments.contains("--amigo-direct-enroll-diagnostic") else { return }
        guard let apiKey = process.environment["AMIGO_DIAGNOSTIC_API_KEY"], !apiKey.isEmpty else {
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=directEnrollDiagnostic result=error mappedCode=SDK_API_KEY_MISSING"
            )
            return
        }

        Task { @MainActor [weak self] in
            guard let self else { return }
            // The vendor uses a foreground URLSession download for the initial
            // 152.9 MB recognition model. Keep this diagnostic launch active
            // long enough to capture initialize -> enrollFace on the device.
            UIApplication.shared.isIdleTimerDisabled = true
            defer { UIApplication.shared.isIdleTimerDisabled = false }
            do {
                let documents = try FileManager.default.url(
                    for: .documentDirectory,
                    in: .userDomainMask,
                    appropriateFor: nil,
                    create: true
                )
                let imageURL = documents.appendingPathComponent("amigo-error9-test.jpg")
                let data = try Data(contentsOf: imageURL)
                guard let image = UIImage(data: data) else {
                    throw NSError(
                        domain: "AmigoFaceSwapPlugin.DirectDiagnostic",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "UIImage decoding failed."]
                    )
                }
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=directEnrollDiagnostic result=imageDecoded bytes=\(data.count) " +
                    "size=\(image.cgImage?.width ?? 0)x\(image.cgImage?.height ?? 0)"
                )

                try await AmigoFaceSwap.initialize(apiKey: apiKey) { progress in
                    let percent = min(100, max(0, Int(progress * 100)))
                    if percent == 0 || percent == 25 || percent == 50 || percent == 75 || percent == 100 {
                        AmigoSDKDiagnostics.record(
                            "[AmigoSDK] stage=directEnrollDiagnostic result=initializeProgress percent=\(percent)"
                        )
                    }
                }
                self.initializationStateLock.lock()
                self.didInitialize = true
                self.initializationTask = nil
                self.initializationStateLock.unlock()
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=directEnrollDiagnostic result=initialized"
                )

                let latent = try await AmigoFaceSwap.enrollFace(from: image)
                self.enrollmentStateLock.lock()
                self.targetLatent = latent
                self.nativeSession.setTargetLatent(latent)
                self.enrollmentStateLock.unlock()
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=directEnrollDiagnostic result=faceLatentReceived " +
                    "latentType=\(String(reflecting: type(of: latent))) latentHash=\(latent.hashValue)"
                )

                guard let buffer = Self.pixelBuffer(from: image) else {
                    throw NSError(
                        domain: "AmigoFaceSwapPlugin.DirectDiagnostic",
                        code: 2,
                        userInfo: [NSLocalizedDescriptionKey: "CVPixelBuffer conversion failed."]
                    )
                }
                let output = try AmigoFaceSwap.processFrame(buffer, using: latent, lipMode: .innerLips)
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=directEnrollDiagnostic result=processFrameComplete " +
                    "output=\(output == nil ? "nil" : "nonNil")"
                )
            } catch {
                AmigoSDKDiagnostics.recordError(
                    stage: "directEnrollDiagnostic",
                    error: error,
                    mappedCode: Self.mappedSDKError(error, stage: "enroll").code
                )
            }
        }
    }
    #endif

    @objc func initialize(_ call: CAPPluginCall) {
        initializationStateLock.lock()
        if didInitialize {
            initializationStateLock.unlock()
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=initialize source=javascript result=success initialized=true reused=true")
            call.resolve(["initialized": true, "reused": true])
            return
        }
        initializationStateLock.unlock()

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

        let task: Task<Void, Error>
        let reusedTask: Bool
        initializationStateLock.lock()
        if let activeTask = initializationTask {
            task = activeTask
            reusedTask = true
        } else {
            let progressLogger = AmigoInitializationProgressLogger()
            task = Task.detached(priority: .userInitiated) {
                try await AmigoFaceSwap.initialize(apiKey: apiKey) { progress in
                    progressLogger.record(progress)
                }
            }
            initializationTask = task
            reusedTask = false
        }
        initializationStateLock.unlock()

        Task { @MainActor [weak self] in
            guard let self else {
                call.reject("The native image processor plugin was released.", "SDK_PLUGIN_RELEASED")
                return
            }
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=initialize source=javascript result=started reusedTask=\(reusedTask)"
            )
            do {
                try await task.value
                self.initializationStateLock.lock()
                self.didInitialize = true
                self.initializationTask = nil
                self.initializationStateLock.unlock()
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=initialize source=javascript result=success initialized=true"
                )
                call.resolve(["initialized": true, "reused": reusedTask])
            } catch {
                self.initializationStateLock.lock()
                self.didInitialize = false
                self.initializationTask = nil
                self.initializationStateLock.unlock()
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
        let normalizedImage = Self.normalizedFaceImageForEnrollment(decodedImage)
        let imageWidth = normalizedImage.cgImage?.width ?? Int(normalizedImage.size.width * normalizedImage.scale)
        let imageHeight = normalizedImage.cgImage?.height ?? Int(normalizedImage.size.height * normalizedImage.scale)
        let imageDetails: PluginCallResultData = [
            "imageByteLength": data.count,
            "imageWidth": imageWidth,
            "imageHeight": imageHeight,
            "imageOrientation": normalizedImage.imageOrientation.rawValue
        ]
        AmigoSDKDiagnostics.record(
            "[AmigoSDK] stage=imageDecode result=success bytes=\(data.count) size=\(imageWidth)x\(imageHeight) orientation=\(normalizedImage.imageOrientation.rawValue)"
        )
        enrollmentStateLock.lock()
        enrollmentGeneration += 1
        let requestGeneration = enrollmentGeneration
        enrollmentStateLock.unlock()
        Task { @MainActor [weak self] in
            guard let self else {
                call.reject("The native image processor plugin was released.", "SDK_PLUGIN_RELEASED")
                return
            }
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=enrollFace result=started")
            let latent: FaceLatent
            do {
                // Match official flow, but include strict compatibility fallbacks:
                // same pixel basis can fail on edge images; retry with a clean JPEG
                // decode and a fixed max-size variant.
                latent = try await Self.enrollWithFallbacks(
                    from: normalizedImage,
                    rawData: data,
                    details: imageDetails
                )
            } catch {
                self.rejectSDKError(
                    call,
                    stage: "enroll",
                    error: error,
                    details: imageDetails
                )
                return
            }
            // Only the newest explicit photo selection may replace the face
            // used by the live video publisher.
            self.enrollmentStateLock.lock()
            guard requestGeneration == self.enrollmentGeneration else {
                self.enrollmentStateLock.unlock()
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=enrollFace result=ignored mappedCode=FACE_ENROLL_SUPERSEDED generation=\(requestGeneration)"
                )
                self.reject(
                    call,
                    stage: "enroll",
                    code: "FACE_ENROLL_SUPERSEDED",
                    message: "A newer face enrollment request replaced this request.",
                    details: imageDetails
                )
                return
            }
            self.targetLatent = latent
            // Commit both consumers while the generation guard is held. A
            // concurrent clear must not leave the plugin empty while the
            // publisher still retains the just-enrolled FaceLatent.
            self.nativeSession.setTargetLatent(latent)
            self.enrollmentStateLock.unlock()
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=enrollFace result=success faceLatentReceived=true " +
                "latentType=\(String(reflecting: type(of: latent))) latentHash=\(latent.hashValue) " +
                "targetLatentStored=true nativeSessionUpdated=true"
            )
            var success = imageDetails
            success["success"] = true
            success["enrolled"] = true
            success["hasTargetFace"] = true
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

    private static func enrollWithFallbacks(
        from image: UIImage,
        rawData: Data,
        details: PluginCallResultData
    ) async throws -> FaceLatent {
        var candidates: [UIImage] = Self.enrollmentCandidates(
            from: image,
            rawData: rawData
        )

        if let faceCrop = Self.enrollmentFaceCropCandidate(from: image) {
            candidates.insert(faceCrop, at: 0)
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=enrollFace result=candidateAdded type=visionFaceCrop " +
                Self.imageCandidateSignature(faceCrop)
            )
        }

        if let sdkCompatible = Self.makeSDKCompatibleEnrollmentImage(from: image) {
            candidates.insert(sdkCompatible, at: 0)
        }

        if let alignedCompatible = Self.makeAlignedSDKCompatibleEnrollmentImage(from: image) {
            candidates.insert(alignedCompatible, at: 0)
        }

        candidates.append(Self.strictNormalizedEnrollmentImage(image))
        candidates.append(Self.makeStrictCandidate(from: Self.normalizedOrientationImage(image), maxSide: 1024))
        candidates.append(Self.makeStrictCandidate(from: Self.normalizedOrientationImage(image), maxSide: 768))

        let canonicalCandidate = Self.canonicalEnrollmentImage(image)
        if let encoded = canonicalCandidate.jpegData(compressionQuality: 1.0),
           let fromCanonical = UIImage(data: encoded) {
            candidates.insert(fromCanonical, at: 0)
        }

        // Keep first candidate only if different from prior ones.
        var unique: [UIImage] = []
        for candidate in candidates {
            if let first = unique.first,
               let c1 = first.pngData(),
               let c2 = candidate.pngData(),
               c1 == c2 {
                continue
            }
            unique.append(candidate)
        }

        var lastError: Error?
        for (index, candidate) in unique.enumerated() {
            let candidateBytes = Self.imageCandidateByteLength(candidate)
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=enrollFace result=attempt index=\(index + 1) " +
                Self.imageCandidateSignature(candidate) +
                " bytes=\(candidateBytes)"
            )
            do {
                return try await AmigoFaceSwap.enrollFace(from: candidate)
            } catch {
                lastError = error
                let mapped = mappedSDKError(error, stage: "enroll")
                AmigoSDKDiagnostics.recordError(
                    stage: "enrollFaceAttempt",
                    error: error,
                    mappedCode: "\(mapped.code)#\(index + 1)"
                )
                if let nsError = error as NSError? {
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=enrollFaceAttemptDebug index=\(index + 1) " +
                        "domain=\(nsError.domain) code=\(nsError.code) " +
                        "userInfoKeys=\(Array(nsError.userInfo.keys).map { String(describing: $0) }.joined(separator: ","))"
                    )
                }
            }
        }

        if let lastError {
            let mapped = mappedSDKError(lastError, stage: "enroll")
            if let sdkError = lastError as? AmigoError {
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=enrollFace result=allCandidatesFailed " +
                    "mapped=\(mapped.code)/\(officialSDKCase(sdkError)) " +
                    "message=\(sdkError.localizedDescription) detailKeys=\(Array(details.keys))"
                )
            } else {
                let nsError = lastError as NSError
                AmigoSDKDiagnostics.record(
                    "[AmigoSDK] stage=enrollFace result=allCandidatesFailed " +
                    "mapped=\(mapped.code) " +
                    "rawError=\(String(reflecting: lastError)) " +
                    "domain=\(nsError.domain) code=\(nsError.code)"
                )
            }
            throw lastError
        }

        throw NSError(
            domain: "AmigoFaceSwapPlugin",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "No valid enrollment candidate images were available."]
        )
    }

    private static func canonicalEnrollmentImage(_ image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else {
            return image
        }
        let size = CGSize(width: CGFloat(cgImage.width), height: CGFloat(cgImage.height))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            context.cgContext.interpolationQuality = .high
            context.cgContext.draw(cgImage, in: CGRect(origin: .zero, size: size))
        }
    }

    private static func enrollmentCandidates(from image: UIImage, rawData: Data) -> [UIImage] {
        var candidates: [UIImage] = []
        candidates.append(image)

        candidates.append(normalizedOrientationImage(image))
        candidates.append(strictNormalizedEnrollmentImage(image))

        if let jpegImage = UIImage(data: rawData), let fromJPEG = jpegFromImage(jpegImage) {
            candidates.append(fromJPEG)
        }

        if let fromRawJPEG = jpegFromData(rawData) {
            candidates.append(fromRawJPEG)
        }

        if image.size.width > 1024 || image.size.height > 1024,
           let fixed = resizedForEnrollment(image, maxSide: 1024) {
            candidates.append(fixed)
        }

        if image.size.width > 768 || image.size.height > 768,
           let fixed = resizedForEnrollment(image, maxSide: 768) {
            candidates.append(fixed)
        }

        if let rawPixels = stdRGBAImage(image), let fixedFromPixels = resizedAndNormalized(rawPixels, maxSide: 1024) {
            candidates.append(fixedFromPixels)
        }

        if let std = stdRGBAImage(rawDataImage: rawData) {
            candidates.append(std)
        }

        return candidates
    }

    private static func enrollmentFaceCropCandidate(from image: UIImage) -> UIImage? {
        guard let cgImage = image.cgImage else { return nil }

        let request = VNDetectFaceRectanglesRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage)
        do {
            try handler.perform([request])
        } catch {
            AmigoSDKDiagnostics.recordError(
                stage: "enrollFaceCropPrecheck",
                error: error,
                mappedCode: "VISION_DETECT_RECTANGLE_FAILED"
            )
            return nil
        }

        guard let observations = request.results as? [VNFaceObservation],
              let first = observations.sorted(by: { a, b in
                  (a.confidence > b.confidence)
              }).first else {
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=enrollFaceCropPrecheck result=faceNotFound"
            )
            return nil
        }

        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        let bounding = first.boundingBox
        let faceRect = CGRect(
            x: bounding.origin.x * width,
            y: (1 - bounding.origin.y - bounding.size.height) * height,
            width: bounding.size.width * width,
            height: bounding.size.height * height
        )

        let padding = max(faceRect.width, faceRect.height) * 0.85
        let cx = faceRect.midX
        let cy = faceRect.midY
        let cropSide = max(1, min(max(faceRect.width + padding, faceRect.height + padding), max(width, height)))
        let half = cropSide / 2
        var x = cx - half
        var y = cy - half
        var side = max(1, min(width, height, cropSide))
        if x < 0 { x = 0 }
        if y < 0 { y = 0 }
        if x + side > width { x = width - side }
        if y + side > height { y = height - side }

        let square = CGRect(
            x: x,
            y: y,
            width: side,
            height: side
        )

        guard let cropped = cgImage.cropping(to: square) else {
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=enrollFaceCropPrecheck result=cropFailed"
            )
            return nil
        }

        let result = UIImage(cgImage: cropped, scale: 1, orientation: .up)
        AmigoSDKDiagnostics.record(
            "[AmigoSDK] stage=enrollFaceCropPrecheck result=success confidence=\(String(format: "%.2f", first.confidence)) " +
            "faceRect=\(Int(faceRect.width))x\(Int(faceRect.height)) " +
            "crop=\(Int(square.width))x\(Int(square.height))"
        )
        return result
    }

    private static func jpegFromData(_ data: Data) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return nil
        }
        return UIImage(cgImage: cgImage)
    }

    private static func stdRGBAImage(_ image: UIImage) -> UIImage? {
        guard let cgImage = image.cgImage else { return nil }
        return stdRGBAImage(cgImage: cgImage)
    }

    private static func stdRGBAImage(rawDataImage data: Data) -> UIImage? {
        guard let cgImage = UIImage(data: data)?.cgImage else { return nil }
        return stdRGBAImage(cgImage: cgImage)
    }

    private static func stdRGBAImage(cgImage: CGImage) -> UIImage? {
        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
        return renderer.image { context in
            context.cgContext.interpolationQuality = .high
            context.cgContext.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    private static func makeSDKCompatibleEnrollmentImage(from image: UIImage) -> UIImage? {
        guard let cgImage = image.cgImage else { return nil }
        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        guard width > 0, height > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
        return renderer.image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: CGSize(width: width, height: height)))
            context.cgContext.interpolationQuality = .high
            context.cgContext.draw(cgImage, in: CGRect(origin: .zero, size: CGSize(width: width, height: height)))
        }
    }

    private static func makeAlignedSDKCompatibleEnrollmentImage(from image: UIImage) -> UIImage? {
        guard let normalized = normalizedOrientationImage(image).cgImage else { return nil }
        let rawWidth = Int(normalized.width)
        let rawHeight = Int(normalized.height)
        guard rawWidth > 0, rawHeight > 0 else { return nil }

        // Vision/CoreML in Amigo's enrollment path often prefers predictable
        // raster geometry. Aligning to even dimensions avoids allocator failures
        // in some edge cases when creating internal face detection info.
        let alignedWidth = max(2, rawWidth & ~1)
        let alignedHeight = max(2, rawHeight & ~1)
        let target = CGSize(width: alignedWidth, height: alignedHeight)

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)

        return renderer.image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: target))
            context.cgContext.interpolationQuality = .high
            context.cgContext.draw(normalized, in: CGRect(origin: .zero, size: target))
        }
    }

    private static func resizedAndNormalized(_ image: UIImage, maxSide: CGFloat) -> UIImage? {
        guard let cgImage = image.cgImage else { return nil }
        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        let maxDimension = max(width, height)
        guard maxDimension > maxSide else { return image }

        let ratio = maxSide / maxDimension
        let target = CGSize(width: max(1, floor(width * ratio)), height: max(1, floor(height * ratio)))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        return renderer.image { context in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    private static func jpegFromImage(_ image: UIImage) -> UIImage? {
        guard let data = image.jpegData(compressionQuality: 0.95),
              let imageFromJPEG = UIImage(data: data) else {
            return nil
        }
        return imageFromJPEG
    }

    private static func resizedForEnrollment(_ image: UIImage, maxSide: CGFloat) -> UIImage? {
        let cgImage = image.cgImage
        let width = CGFloat(cgImage?.width ?? Int(image.size.width * image.scale))
        let height = CGFloat(cgImage?.height ?? Int(image.size.height * image.scale))
        let maxDimension = max(width, height)
        guard maxDimension > maxSide else { return image }

        let scale = maxSide / maxDimension
        let target = CGSize(width: width * scale, height: height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        return renderer.image { context in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    @objc func processFrame(_ call: CAPPluginCall) {
        guard didInitialize else {
            AmigoSDKDiagnostics.record("[AmigoSDK] stage=processFrame result=error mappedCode=SDK_NOT_INITIALIZED")
            call.resolve(["swapped": false, "imageData": NSNull()])
            return
        }
        enrollmentStateLock.lock()
        let latent = targetLatent
        enrollmentStateLock.unlock()
        guard let latent else {
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
        enrollmentStateLock.lock()
        enrollmentGeneration += 1
        targetLatent = nil
        nativeSession.setTargetLatent(nil)
        enrollmentStateLock.unlock()
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
            call.reject("Amigo SDK has not been initialized.", "SDK_NOT_INITIALIZED")
            return
        }
        let url = call.getString("url") ?? ""
        let token = call.getString("token") ?? ""
        let enableMicrophone = call.getBool("enableMicrophone") ?? true
        let enableCamera = call.getBool("enableCamera") ?? true
        guard !url.isEmpty, !token.isEmpty else {
            call.reject("connectNativeRoom requires both 'url' and 'token'.", "FACE_SWAP_SESSION_INVALID_ARGS")
            return
        }
        let preStatus = nativeSession.status()
        let preConnected = preStatus["connected"] as? Bool ?? false
        let preHasTargetFace = preStatus["hasTargetFace"] as? Bool ?? false
        let preFaceSwapEnabled = preStatus["faceSwapEnabled"] as? Bool ?? false
        AmigoSDKDiagnostics.record(
            "[AmigoSDK] stage=connectNativeRoomPrecheck result=state " +
            "connected=\(preConnected) " +
            "hasTargetFace=\(preHasTargetFace) " +
            "faceSwapEnabled=\(preFaceSwapEnabled)"
        )
        processingQueue.async {
            self.nativeSession.connect(
                url: url,
                token: token,
                enableMicrophone: enableMicrophone,
                enableCamera: enableCamera
            ) { failure in
                if let failure {
                    CAPLog.print(
                        "[AmigoFaceSwapPlugin] connectNativeRoom failed " +
                        "stage=\(failure.stage) code=\(failure.code): \(failure.message)"
                    )
                    var details = self.nativeSession.status()
                    details["precheck"] = preStatus
                    details["nativeStage"] = failure.stage
                    self.reject(
                        call,
                        stage: failure.stage,
                        code: failure.code,
                        message: failure.message,
                        error: failure.error,
                        details: details
                    )
                } else {
                    let status = self.nativeSession.status()
                    let connected = status["connected"] as? Bool ?? false
                    AmigoSDKDiagnostics.record(
                        "[AmigoSDK] stage=connectNativeRoom result=success " +
                        "connected=\(connected)"
                    )
                    call.resolve(status)
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
            message: error.localizedDescription,
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
            let ns = error as NSError
            let code = ns.code
            let domain = ns.domain
            if stage == "enroll" && code == 9 {
                return (
                    "SDK_ENROLL_CREATE_INFO_FAILED",
                    "Could not create info. (domain: \(domain), code: \(code)) \(ns.localizedDescription)"
                )
            }
            let message = ns.localizedDescription
            return (
                "SDK_UNKNOWN_ERROR",
                "[\(domain):\(code)] \(message)"
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

    private static func normalizedFaceImageForEnrollment(_ source: UIImage) -> UIImage {
        let correctedOrientation = normalizedOrientationImage(source)
        guard let cgImage = correctedOrientation.cgImage else { return source }
        let maxDimension: CGFloat = 1536
        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        let maxSide = max(width, height)
        guard maxSide > maxDimension else { return correctedOrientation }

        let scale = maxDimension / maxSide
        let target = CGSize(width: width * scale, height: height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        return renderer.image { context in
            correctedOrientation.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    private static func normalizedOrientationImage(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up else { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
        let normalized = renderer.image { context in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
        return normalized
    }

    private static func strictNormalizedEnrollmentImage(_ image: UIImage) -> UIImage {
        guard let cgImage = image.cgImage else { return image }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: cgImage.width, height: cgImage.height), format: format)
        return renderer.image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: CGSize(width: cgImage.width, height: cgImage.height)))
            context.cgContext.interpolationQuality = .high
            context.cgContext.draw(cgImage, in: CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))
        }
    }

    private static func makeStrictCandidate(from image: UIImage, maxSide: CGFloat) -> UIImage {
        return normalizedFaceImageForEnrollmentStrict(image, maxDimension: maxSide)
    }

    private static func normalizedFaceImageForEnrollmentStrict(_ source: UIImage, maxDimension: CGFloat) -> UIImage {
        let correctedOrientation = strictNormalizedEnrollmentImage(source)
        guard let cgImage = correctedOrientation.cgImage else { return correctedOrientation }
        let width = CGFloat(cgImage.width)
        let height = CGFloat(cgImage.height)
        let maxCurrentSide = max(width, height)
        if maxCurrentSide <= maxDimension {
            return correctedOrientation
        }
        let scale = maxDimension / maxCurrentSide
        let target = CGSize(width: width * scale, height: height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: target, format: format)
        return renderer.image { context in
            UIColor.black.setFill()
            context.fill(CGRect(origin: .zero, size: target))
            context.cgContext.interpolationQuality = .high
            context.cgContext.draw(correctedOrientation.cgImage!, in: CGRect(origin: .zero, size: target))
        }
    }

    private static func imageCandidateSignature(_ image: UIImage) -> String {
        guard let cgImage = image.cgImage else {
            return "size=0x0 orientation=\(image.imageOrientation.rawValue)"
        }
        let bytesPerPixel = cgImage.bitsPerPixel > 0 ? cgImage.bitsPerPixel / 8 : 0
        return "size=\(cgImage.width)x\(cgImage.height) " +
        "orientation=\(image.imageOrientation.rawValue) " +
        "bpp=\(cgImage.bitsPerPixel) bpc=\(cgImage.bitsPerComponent) " +
        "bytesPerRow=\(cgImage.bytesPerRow) bytesPerPixel=\(bytesPerPixel)"
    }

    private static func imageCandidateByteLength(_ image: UIImage) -> Int {
        guard let data = image.jpegData(compressionQuality: 1.0) else {
            return 0
        }
        return data.count
    }

    private static func rasterized(_ image: CIImage) -> UIImage? {
        let context = CIContext(options: nil)
        let extent = image.extent
        guard extent.width > 0, extent.height > 0,
              let cgImage = context.createCGImage(image, from: extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

private struct NativeRoomConnectFailure {
    let stage: String
    let code: String
    let message: String
    let error: Error

    init(stage: String, code explicitCode: String? = nil, error: Error) {
        self.stage = stage
        self.error = error
        self.message = error.localizedDescription
        if let explicitCode {
            self.code = explicitCode
            return
        }
        switch stage {
        case "livekit-room-connect":
            self.code = "LIVEKIT_ROOM_CONNECT_FAILED"
        case "microphone-publish":
            self.code = "LIVEKIT_MICROPHONE_PUBLISH_FAILED"
        case "processed-video-publish":
            self.code = "LIVEKIT_PROCESSED_VIDEO_PUBLISH_FAILED"
        default:
            self.code = "NATIVE_ROOM_CONNECT_FAILED"
        }
    }
}

private final class NativeLiveKitSession {
    private let stateLock = NSLock()
    private var room: Room?
    private var roomURL: String?
    private var targetLatent: FaceLatent?
    private var faceSwapEnabled = false
    private var publishedVideoTrack: LocalVideoTrack?
    private var publishedVideoPublication: LocalTrackPublication?
    private var publishedProcessor: AmigoRealtimeVideoProcessor?
    private var connectionGeneration: UInt64 = 0
    private var pendingRoom: Room?
    private var pendingConnectTask: Task<Void, Never>?
    private var pendingProcessor: AmigoRealtimeVideoProcessor?

    func setTargetLatent(_ latent: FaceLatent?) {
        stateLock.lock()
        targetLatent = latent
        publishedProcessor?.setTargetLatent(latent)
        pendingProcessor?.setTargetLatent(latent)
        stateLock.unlock()
    }

    func setFaceSwapEnabled(_ enabled: Bool) {
        stateLock.lock()
        faceSwapEnabled = enabled
        publishedProcessor?.setEnabled(enabled)
        pendingProcessor?.setEnabled(enabled)
        stateLock.unlock()
        CAPLog.print("[NativeLiveKitSession] face swap toggled: \(enabled)")
    }

    func connect(
        url: String,
        token: String,
        enableMicrophone: Bool,
        enableCamera: Bool,
        completion: @escaping (NativeRoomConnectFailure?) -> Void
    ) {
        stateLock.lock()
        let hasExistingSession = room != nil || pendingRoom != nil
        stateLock.unlock()

        if hasExistingSession {
            disconnect()
        }

        let room = Room()
        let processor = AmigoRealtimeVideoProcessor()

        stateLock.lock()
        let currentEnabled = faceSwapEnabled
        let currentLatent = targetLatent
        processor.setTargetLatent(currentLatent)
        processor.setEnabled(currentEnabled)
        if enableCamera && (!currentEnabled || currentLatent == nil) {
            stateLock.unlock()
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=nativeRoomConnect result=error " +
                "mappedCode=FACE_SWAP_NOT_READY rawCameraPublished=false"
            )
            let error = NSError(
                domain: "TokyoConnect.NativeLiveKitSession",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "FACE_SWAP_NOT_READY"]
            )
            completion(NativeRoomConnectFailure(
                stage: "processed-video-publish",
                code: "FACE_SWAP_NOT_READY",
                error: error
            ))
            return
        }
        connectionGeneration &+= 1
        let generation = connectionGeneration
        pendingRoom = room
        pendingProcessor = processor
        stateLock.unlock()

        let connectTask = Task {
            var stage = "livekit-room-connect"
            var localVideoTrack: LocalVideoTrack?
            var localVideoPublication: LocalTrackPublication?
            do {
                AmigoSDKDiagnostics.record(
                    "[NativeRoom] stage=livekit-room-connect result=started"
                )
                try await room.connect(url: url, token: token)
                try self.ensureConnectionIsCurrent(generation)
                AmigoSDKDiagnostics.record(
                    "[NativeRoom] stage=livekit-room-connect result=success"
                )
                if enableMicrophone {
                    stage = "microphone-publish"
                    AmigoSDKDiagnostics.record(
                        "[NativeRoom] stage=microphone-publish result=started"
                    )
                    try await room.localParticipant.setMicrophone(enabled: true)
                    try self.ensureConnectionIsCurrent(generation)
                    AmigoSDKDiagnostics.record(
                        "[NativeRoom] stage=microphone-publish result=success"
                    )
                }
                if enableCamera {
                    stage = "processed-video-publish"
                    AmigoSDKDiagnostics.record(
                        "[NativeRoom] stage=processed-video-publish result=started " +
                        "rawCameraPublished=false"
                    )
                    processor.prepareForPublish()
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
                    localVideoTrack = videoTrack
                    localVideoPublication = publication
                    try self.ensureConnectionIsCurrent(generation)
                    AmigoSDKDiagnostics.record(
                        "[NativeRoom] stage=processed-video-publish result=success " +
                        "rawCameraPublished=false"
                    )
                }
                try self.commitConnection(
                    generation: generation,
                    room: room,
                    url: url,
                    videoTrack: localVideoTrack,
                    videoPublication: localVideoPublication,
                    processor: processor
                )
                CAPLog.print("[NativeLiveKitSession] native room connected")
                completion(nil)
            } catch {
                let failure: NativeRoomConnectFailure
                if error is CancellationError {
                    let cancellation = NSError(
                        domain: "TokyoConnect.NativeLiveKitSession",
                        code: 2,
                        userInfo: [
                            NSLocalizedDescriptionKey: "Native room connection was cancelled."
                        ]
                    )
                    failure = NativeRoomConnectFailure(
                        stage: stage,
                        code: "NATIVE_ROOM_CONNECT_CANCELLED",
                        error: cancellation
                    )
                } else {
                    failure = NativeRoomConnectFailure(stage: stage, error: error)
                }
                AmigoSDKDiagnostics.recordError(
                    stage: stage,
                    error: failure.error,
                    mappedCode: failure.code
                )
                if let localVideoPublication {
                    try? await room.localParticipant.unpublish(publication: localVideoPublication)
                } else if let localVideoTrack {
                    try? await localVideoTrack.stop()
                }
                if enableMicrophone {
                    try? await room.localParticipant.setMicrophone(enabled: false)
                }
                await room.disconnect()
                self.clearPendingConnection(generation: generation)
                CAPLog.print(
                    "[NativeLiveKitSession] native room connect failed " +
                    "stage=\(failure.stage) code=\(failure.code): \(failure.message)"
                )
                completion(failure)
            }
        }

        stateLock.lock()
        if generation == connectionGeneration {
            pendingConnectTask = connectTask
        } else {
            connectTask.cancel()
        }
        stateLock.unlock()
    }

    func disconnect() {
        CAPLog.print("[NativeLiveKitSession] disconnecting native room")
        stateLock.lock()
        connectionGeneration &+= 1
        let pendingTask = pendingConnectTask
        let connectingRoom = pendingRoom
        let connectingProcessor = pendingProcessor
        let activeRoom = room
        let videoPublication = publishedVideoPublication
        let videoTrack = publishedVideoTrack
        let activeProcessor = publishedProcessor
        pendingConnectTask = nil
        pendingRoom = nil
        pendingProcessor = nil
        room = nil
        roomURL = nil
        publishedVideoPublication = nil
        publishedVideoTrack = nil
        publishedProcessor = nil
        stateLock.unlock()

        pendingTask?.cancel()
        Task { [connectingProcessor, activeProcessor] in
            if let connectingRoom {
                await connectingRoom.disconnect()
            }
            if let videoPublication {
                try? await activeRoom?.localParticipant.unpublish(publication: videoPublication)
            } else if let videoTrack {
                try? await videoTrack.stop()
            }
            await activeRoom?.disconnect()
            // LiveKit's capturer keeps its processor weakly. Retain both processors
            // until every associated track and room has stopped so no raw camera
            // frame can bypass processing during disconnect or rapid reconnect.
            _ = connectingProcessor
            _ = activeProcessor
        }
    }

    func status() -> PluginCallResultData {
        stateLock.lock()
        let result: PluginCallResultData = [
            "connected": room != nil,
            "roomUrl": roomURL as Any,
            "faceSwapEnabled": faceSwapEnabled,
            "hasTargetFace": targetLatent != nil,
            "pipeline": "native-livekit"
        ]
        stateLock.unlock()
        return result
    }

    private func ensureConnectionIsCurrent(_ generation: UInt64) throws {
        guard !Task.isCancelled else {
            throw CancellationError()
        }
        stateLock.lock()
        let isCurrent = generation == connectionGeneration
        stateLock.unlock()
        guard isCurrent else {
            throw CancellationError()
        }
    }

    private func commitConnection(
        generation: UInt64,
        room: Room,
        url: String,
        videoTrack: LocalVideoTrack?,
        videoPublication: LocalTrackPublication?,
        processor: AmigoRealtimeVideoProcessor
    ) throws {
        guard !Task.isCancelled else {
            throw CancellationError()
        }
        stateLock.lock()
        defer { stateLock.unlock() }
        guard generation == connectionGeneration else {
            throw CancellationError()
        }
        self.room = room
        roomURL = url
        publishedVideoTrack = videoTrack
        publishedVideoPublication = videoPublication
        publishedProcessor = processor
        pendingRoom = nil
        pendingConnectTask = nil
        pendingProcessor = nil
    }

    private func clearPendingConnection(generation: UInt64) {
        stateLock.lock()
        if generation == connectionGeneration {
            pendingRoom = nil
            pendingConnectTask = nil
            pendingProcessor = nil
        }
        stateLock.unlock()
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

private final class AmigoRealtimeVideoProcessor: NSObject, LiveKit.VideoProcessor {
    private let stateLock = NSLock()
    private let ciContext = CIContext(options: nil)
    private var targetLatent: FaceLatent?
    private var faceSwapEnabled = false
    private var cachedPixelBuffer: CVPixelBuffer?
    private var cachedBufferSize: CGSize?
    private var didLogFirstProcessedFrame = false
    private var didEmitPublishBootstrap = false
    private var loggedPrivacyReasons = Set<String>()

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

    func prepareForPublish() {
        stateLock.lock()
        didEmitPublishBootstrap = false
        stateLock.unlock()
    }

    func process(frame: VideoFrame) -> VideoFrame? {
        stateLock.lock()
        let latent = targetLatent
        let enabled = faceSwapEnabled
        let shouldEmitPublishBootstrap = enabled && latent != nil && !didEmitPublishBootstrap
        if shouldEmitPublishBootstrap {
            didEmitPublishBootstrap = true
        }
        stateLock.unlock()

        guard enabled, let latent else {
            return privacyPlaceholderFrame(for: frame, reason: "processorNotReady")
        }
        if shouldEmitPublishBootstrap {
            return privacyPlaceholderFrame(for: frame, reason: "trackDimensionBootstrap")
        }
        guard let inputBuffer = frame.toCVPixelBuffer() else {
            return privacyPlaceholderFrame(for: frame, reason: "inputPixelBufferUnavailable")
        }

        do {
            guard let outputImage = try AmigoFaceSwap.processFrame(
                inputBuffer,
                using: latent,
                lipMode: .innerLips
            ) else {
                return privacyPlaceholderFrame(for: frame, reason: "noFaceDetectedInFrame")
            }
            let size = CGSize(
                width: Int(frame.dimensions.width),
                height: Int(frame.dimensions.height)
            )
            guard let outputBuffer = getOutputBuffer(for: size) else {
                return privacyPlaceholderFrame(for: frame, reason: "outputBufferAllocationFailed")
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
            return privacyPlaceholderFrame(for: frame, reason: "sdkProcessingFailed")
        }
    }

    private func privacyPlaceholderFrame(for frame: VideoFrame, reason: String) -> VideoFrame? {
        let size = CGSize(
            width: Int(frame.dimensions.width),
            height: Int(frame.dimensions.height)
        )
        guard size.width > 0,
              size.height > 0,
              let outputBuffer = getOutputBuffer(for: size) else {
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=realtimeProcessFrame result=dropped " +
                "reason=privacyBufferAllocationFailed rawCameraPublished=false"
            )
            return nil
        }

        let blackImage = CIImage(
            color: CIColor(red: 0, green: 0, blue: 0, alpha: 1)
        ).cropped(to: CGRect(origin: .zero, size: size))
        ciContext.render(blackImage, to: outputBuffer)

        stateLock.lock()
        let shouldLog = loggedPrivacyReasons.insert(reason).inserted
        stateLock.unlock()
        if shouldLog {
            AmigoSDKDiagnostics.record(
                "[AmigoSDK] stage=realtimeProcessFrame result=privacyPlaceholder " +
                "reason=\(reason) rawCameraPublished=false"
            )
        }

        return VideoFrame(
            dimensions: frame.dimensions,
            rotation: frame.rotation,
            timeStampNs: frame.timeStampNs,
            buffer: CVPixelVideoBuffer(pixelBuffer: outputBuffer)
        )
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
