import fs from "node:fs";
import assert from "node:assert/strict";

const source = fs.readFileSync(
  "ios/App/CapApp-SPM/Sources/CapApp-SPM/AmigoFaceSwapPlugin.swift",
  "utf8",
);

assert.match(source, /--amigo-direct-enroll-diagnostic/);
assert.match(source, /AMIGO_DIAGNOSTIC_API_KEY/);
assert.match(source, /amigo-error9-test\.jpg/);
assert.match(source, /stage=directEnrollDiagnostic result=faceLatentReceived/);
assert.match(source, /AmigoFaceSwap\.processFrame\(/);
assert.match(source, /#if DEBUG[\s\S]*runDirectEnrollmentDiagnosticIfRequested/);
assert.match(source, /UIApplication\.shared\.isIdleTimerDisabled = true/);
assert.match(source, /defer \{ UIApplication\.shared\.isIdleTimerDisabled = false \}/);
assert.match(source, /final class AmigoDiagnosticModelURLProtocol: URLProtocol/);
assert.match(source, /lastPathComponent == "w600k_r50\.enc"/);
assert.match(source, /URLProtocol\.registerClass\(AmigoDiagnosticModelURLProtocol\.self\)/);
assert.match(source, /final class AmigoDiagnosticURLSessionConfiguration/);
assert.match(source, /class_getClassMethod\(URLSessionConfiguration\.self, selector\)/);
assert.match(source, /AmigoDiagnosticURLSessionConfiguration\.install\(\)/);
assert.match(source, /stage=modelDownloadIntercept result=started/);
assert.match(source, /stage=modelDownloadIntercept result=completed/);
assert.match(source, /stage=visionCompatibility result=disabled/);
assert.doesNotMatch(source, /AmigoVisionLandmarksCompatibility/);

console.log("amigo Debug direct-enroll contract passed");
