package expo.modules.tvfeedbackintegrity

import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID

class TvFeedbackIntegrityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TvFeedbackIntegrity")

    AsyncFunction("attestGrant") { challengeId: String, nonce: String, utcDay: String, cloudProjectNumber: String, promise: Promise ->
      try {
        val context = requireNotNull(appContext.reactContext) { "Application unavailable" }
        val projectNumber = cloudProjectNumber.toLongOrNull() ?: throw IllegalArgumentException("Invalid cloud project")
        val keyPair = installationKey(context)
        val prefs = context.getSharedPreferences("watch_feedback", Context.MODE_PRIVATE)
        val installationId = prefs.getString("installation_id", null) ?: UUID.randomUUID().toString().also {
          prefs.edit().putString("installation_id", it).apply()
        }
        val publicKey = keyPair.public.encoded
        val fingerprint = encode(MessageDigest.getInstance("SHA-256").digest(publicKey))
        val versionCode = if (Build.VERSION.SDK_INT >= 28)
          context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode
        else context.packageManager.getPackageInfo(context.packageName, 0).versionCode.toLong()
        val tvManager = context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
        val tvMode = tvManager.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
          context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
        val canonical = listOf("feedback-qr-v1", challengeId, nonce, utcDay, installationId, fingerprint, context.packageName, versionCode.toString()).joinToString("\n")
        val signer = Signature.getInstance("SHA256withECDSA")
        signer.initSign(keyPair.private)
        signer.update(canonical.toByteArray(Charsets.UTF_8))
        val signature = encode(signer.sign())
        val requestHash = encode(MessageDigest.getInstance("SHA-256").digest(canonical.toByteArray(Charsets.UTF_8)))
        val manager = IntegrityManagerFactory.createStandard(context)
        manager.prepareIntegrityToken(
          StandardIntegrityManager.PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(projectNumber).build()
        ).addOnSuccessListener { provider ->
          provider.request(
            StandardIntegrityManager.StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build()
          ).addOnSuccessListener { token ->
            promise.resolve(mapOf(
              "installationId" to installationId,
              "publicKey" to encode(publicKey),
              "keyFingerprint" to fingerprint,
              "packageName" to context.packageName,
              "versionCode" to versionCode,
              "tvMode" to tvMode,
              "signature" to signature,
              "integrityToken" to token.token(),
            ))
          }.addOnFailureListener { error -> promise.reject("INTEGRITY_TOKEN_FAILED", "Play Integrity token unavailable", error) }
        }.addOnFailureListener { error -> promise.reject("INTEGRITY_PREPARE_FAILED", "Play Integrity unavailable", error) }
      } catch (error: Exception) {
        promise.reject("INTEGRITY_REQUEST_FAILED", "Verified feedback unavailable", error)
      }
    }
  }

  private fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

  private fun installationKey(context: Context): KeyPair {
    val alias = "watch-feedback-installation-v1"
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = store.getEntry(alias, null) as? KeyStore.PrivateKeyEntry
    if (existing != null) return KeyPair(existing.certificate.publicKey, existing.privateKey)
    context.getSharedPreferences("watch_feedback", Context.MODE_PRIVATE).edit().remove("installation_id").apply()
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .build())
    return generator.generateKeyPair()
  }
}
