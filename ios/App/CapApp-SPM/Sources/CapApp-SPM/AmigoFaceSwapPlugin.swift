import Foundation
import Capacitor
import UIKit
import CoreImage
import AmigoFaceSwapSDK

/**
 * Native bridge for the Amigo Face Swap iOS SDK.
 *
 * Web side (AISource in `src/lib/video-sources/sources.ts`) sends JPEG frames
 * captured from the LiveKit camera track. Each frame is converted to a
 * CVPixelBuffer, processed synchronously by `AmigoFaceSwap.processFrame`, and
 * the swapped result is returned as JPEG data for re-encoding into the
 * existing WebRTC pipeline.
 */
@objc(AmigoFaceSwapPlugin)
public class AmigoFaceSwapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AmigoFaceSwapPlugin"
    public let jsName = "AmigoFaceSwap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enrollFace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "processFrame", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearModelCache", returnType: CAPPluginReturnPromise)
    ]

    private var targetLatent: FaceLatent?
    private let processingQueue = DispatchQueue(label: "amigo.faceswap.processing", qos: .userInitiated)

    @objc override public func load() {
        let apiKey = getConfig().getString("apiKey")
        if let apiKey, !apiKey.isEmpty {
            initializeSDK(apiKey: apiKey)
        }
    }

    private func initializeSDK(apiKey: String) {
        processingQueue.async {
            let semaphore = DispatchSemaphore(value: 0)
            Task {
                do {
                    try await AmigoFaceSwap.initialize(apiKey: apiKey)
                } catch {
                    CAPLog.print("AmigoFaceSwap initialize failed: \(error.localizedDescription)")
                }
                semaphore.signal()
            }
            _ = semaphore.wait(timeout: .now() + 120)
        }
    }

    @objc func initialize(_ call: CAPPluginCall) {
        let apiKey = call.getString("apiKey") ?? getConfig().getString("apiKey") ?? ""
        guard !apiKey.isEmpty else {
            call.reject("Amigo API key is missing. Provide it via call options or capacitor.config plugins.AmigoFaceSwap.apiKey.")
            return
        }
        processingQueue.async {
            let semaphore = DispatchSemaphore(value: 0)
            var failure: String?
            Task {
                do {
                    try await AmigoFaceSwap.initialize(apiKey: apiKey)
                } catch {
                    failure = error.localizedDescription
                }
                semaphore.signal()
            }
            _ = semaphore.wait(timeout: .now() + 120)
            if let failure {
                call.reject("Amigo initialize failed: \(failure)")
            } else {
                call.resolve()
            }
        }
    }

    @objc func enrollFace(_ call: CAPPluginCall) {
        guard let base64 = call.getString("imageData"),
              let data = Data(base64Encoded: base64),
              let image = UIImage(data: data) else {
            call.reject("enrollFace requires a valid base64 JPEG image in 'imageData'.")
            return
        }
        processingQueue.async {
            let semaphore = DispatchSemaphore(value: 0)
            var latent: FaceLatent?
            var failure: String?
            Task {
                do {
                    latent = try await AmigoFaceSwap.enrollFace(from: image)
                } catch {
                    failure = error.localizedDescription
                }
                semaphore.signal()
            }
            _ = semaphore.wait(timeout: .now() + 60)
            guard let latent else {
                call.reject(failure ?? "Amigo enrollFace failed: no face detected.")
                return
            }
            self.targetLatent = latent
            call.resolve(["enrolled": true])
        }
    }

    @objc func processFrame(_ call: CAPPluginCall) {
        guard let latent = targetLatent else {
            call.resolve(["swapped": false, "imageData": NSNull()])
            return
        }
        guard let base64 = call.getString("imageData"),
              let data = Data(base64Encoded: base64),
              let image = UIImage(data: data),
              let pixelBuffer = Self.pixelBuffer(from: image) else {
            call.resolve(["swapped": false, "imageData": NSNull()])
            return
        }
        processingQueue.async {
            do {
                guard let output = try AmigoFaceSwap.processFrame(pixelBuffer, using: latent),
                      let outputImage = Self.rasterized(output),
                      let jpeg = outputImage.jpegData(compressionQuality: 0.85) else {
                    call.resolve(["swapped": false, "imageData": NSNull()])
                    return
                }
                call.resolve(["swapped": true, "imageData": jpeg.base64EncodedString()])
            } catch {
                call.resolve(["swapped": false, "imageData": NSNull()])
            }
        }
    }

    @objc func clearModelCache(_ call: CAPPluginCall) {
        AmigoFaceSwap.clearModelCache()
        call.resolve()
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
