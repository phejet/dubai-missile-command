import Foundation
import Capacitor
import DeviceCheck

@objc(AppAttestPlugin)
public class AppAttestPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppAttestPlugin"
    public let jsName = "AppAttest"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "attestKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generateAssertion", returnType: CAPPluginReturnPromise)
    ]

    private let service = DCAppAttestService.shared

    @objc func isSupported(_ call: CAPPluginCall) {
        call.resolve(["supported": service.isSupported])
    }

    @objc func generateKey(_ call: CAPPluginCall) {
        guard service.isSupported else {
            call.reject("App Attest is unavailable", "APP_ATTEST_UNSUPPORTED")
            return
        }
        service.generateKey { keyId, error in
            if let keyId {
                call.resolve(["keyId": keyId])
            } else {
                self.reject(call, error: error, fallbackCode: "APP_ATTEST_KEY_FAILED")
            }
        }
    }

    @objc func attestKey(_ call: CAPPluginCall) {
        guard let keyId = call.getString("keyId") else {
            call.reject("keyId is required", "APP_ATTEST_INVALID_KEY_ID")
            return
        }
        guard let hash = clientDataHash(call) else { return }
        service.attestKey(keyId, clientDataHash: hash) { attestation, error in
            if let attestation {
                call.resolve(["attestation": attestation.base64EncodedString()])
            } else {
                self.reject(call, error: error, fallbackCode: "APP_ATTEST_ATTESTATION_FAILED")
            }
        }
    }

    @objc func generateAssertion(_ call: CAPPluginCall) {
        guard let keyId = call.getString("keyId") else {
            call.reject("keyId is required", "APP_ATTEST_INVALID_KEY_ID")
            return
        }
        guard let hash = clientDataHash(call) else { return }
        service.generateAssertion(keyId, clientDataHash: hash) { assertion, error in
            if let assertion {
                call.resolve(["assertion": assertion.base64EncodedString()])
            } else {
                self.reject(call, error: error, fallbackCode: "APP_ATTEST_ASSERTION_FAILED")
            }
        }
    }

    private func clientDataHash(_ call: CAPPluginCall) -> Data? {
        guard
            let encoded = call.getString("clientDataHash"),
            let data = Data(base64Encoded: encoded),
            data.count == 32
        else {
            call.reject("clientDataHash must be 32 bytes", "APP_ATTEST_INVALID_HASH")
            return nil
        }
        return data
    }

    private func reject(_ call: CAPPluginCall, error: Error?, fallbackCode: String) {
        let nsError = error as NSError?
        let code = nsError?.code == DCError.Code.serverUnavailable.rawValue
            ? "APP_ATTEST_SERVER_UNAVAILABLE"
            : nsError.map { "APP_ATTEST_\($0.code)" } ?? fallbackCode
        call.reject("App Attest operation failed", code, error)
    }
}
