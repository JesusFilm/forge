import CryptoKit
import DeviceCheck
import ExpoModulesCore
import Foundation
import Security

public final class TvFeedbackAppleIntegrityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TvFeedbackAppleIntegrity")

    AsyncFunction("attestGrant") { (challengeId: String, nonce: String, utcDay: String, promise: Promise) in
      guard DCDevice.current.isSupported else {
        promise.reject("DEVICECHECK_UNAVAILABLE", "DeviceCheck is unavailable on this Apple TV")
        return
      }
      do {
        let privateKey = try installationKey()
        guard let publicKey = SecKeyCopyPublicKey(privateKey),
              let rawPublic = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?,
              rawPublic.count == 65, rawPublic.first == 0x04,
              let bundleId = Bundle.main.bundleIdentifier,
              let build = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") else {
          throw NSError(domain: "TVFeedback", code: 1)
        }
        let spkiPrefix = Data([0x30,0x59,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x03,0x42,0x00])
        let spki = spkiPrefix + rawPublic
        let fingerprint = Data(SHA256.hash(data: spki)).base64Url
        let defaults = UserDefaults.standard
        let installationId = defaults.string(forKey: "tv_feedback_installation_id") ?? UUID().uuidString.lowercased()
        defaults.set(installationId, forKey: "tv_feedback_installation_id")
        let canonical = ["feedback-qr-v1", challengeId, nonce, utcDay, installationId, fingerprint, bundleId, String(build)].joined(separator: "\n")
        guard let signature = SecKeyCreateSignature(privateKey, .ecdsaSignatureMessageX962SHA256, Data(canonical.utf8) as CFData, nil) as Data? else {
          throw NSError(domain: "TVFeedback", code: 2)
        }
        DCDevice.current.generateToken { token, error in
          guard let token, error == nil else {
            promise.reject("DEVICECHECK_TOKEN_FAILED", "Apple verification is unavailable", error)
            return
          }
          promise.resolve([
            "installationId": installationId,
            "publicKey": spki.base64Url,
            "keyFingerprint": fingerprint,
            "packageName": bundleId,
            "versionCode": build,
            "tvMode": true,
            "signature": signature.base64Url,
            "deviceToken": token.base64EncodedString(),
          ])
        }
      } catch {
        promise.reject("DEVICECHECK_REQUEST_FAILED", "Apple verification is unavailable", error)
      }
    }
  }

  private func installationKey() throws -> SecKey {
    let tag = Data("org.jesusfilm.forgewatch.feedback-key-v1".utf8)
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
    ]
    var item: CFTypeRef?
    if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
       let key = item as? SecKey { return key }
    let attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag,
      ],
    ]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw error?.takeRetainedValue() ?? NSError(domain: "TVFeedback", code: 3)
    }
    UserDefaults.standard.removeObject(forKey: "tv_feedback_installation_id")
    return key
  }
}

private extension Data {
  var base64Url: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
