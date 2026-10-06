package expo.modules.googletvhome

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ResultReceiver
import android.util.Log
import com.google.android.engage.common.datamodel.AccountProfile
import com.google.android.engage.common.datamodel.ClusterType
import com.google.android.engage.common.datamodel.ContentAvailability
import com.google.android.engage.common.datamodel.ContinuationCluster
import com.google.android.engage.common.datamodel.Image
import com.google.android.engage.common.datamodel.PlatformSpecificUri
import com.google.android.engage.common.datamodel.PlatformType
import com.google.android.engage.common.datamodel.RecommendationCluster
import com.google.android.engage.common.datamodel.RecommendationClusterType
import com.google.android.engage.service.AppEngagePublishClient
import com.google.android.engage.service.DeleteClustersRequest
import com.google.android.engage.service.DeleteReason
import com.google.android.engage.service.PublishRecommendationClustersRequest
import com.google.android.engage.service.PublishContinuationClusterRequest
import com.google.android.engage.service.ServiceAvailabilityRequest
import com.google.android.engage.video.datamodel.MovieEntity
import com.google.android.engage.video.datamodel.WatchNextType
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

private val operationInFlight = AtomicBoolean(false)

class GoogleTvVideo : Record {
  @Field var slug: String = ""
  @Field var title: String = ""
  @Field var description: String = ""
  @Field var posterUri: String = ""
  @Field var playbackUri: String = ""
  @Field var durationMillis: Double = 0.0
  @Field var positionMillis: Double = 0.0
  @Field var lastEngagementMillis: Double = 0.0

  fun toJson(continuation: Boolean): JSONObject {
    require(slug.matches(Regex("[a-z0-9-]{1,120}")))
    require(title.isNotBlank() && title.length <= 150)
    require(description.length <= 500)
    require(durationMillis.isFinite() && durationMillis in 1.0..86400000.0)
    require(playbackUri == "org.jesusfilm.forgetv://watch/$slug?autoplay=1")
    val poster = Uri.parse(posterUri)
    require(poster.scheme == "https" && poster.host in setOf("imagedelivery.net", "image.mux.com"))
    require(poster.userInfo == null && poster.port == -1)
    if (poster.host == "imagedelivery.net") {
      require(poster.path?.startsWith("/tMY86qEHFACTO8_0kAeRFA/") == true)
      require(poster.lastPathSegment == "f=jpg,w=448,h=252,fit=cover,q=85")
    } else {
      require(poster.path?.matches(Regex("/[A-Za-z0-9_-]+/thumbnail\\.jpg")) == true)
      require(poster.getQueryParameter("width") == "448" && poster.getQueryParameter("height") == "252")
    }
    if (continuation) {
      require(positionMillis.isFinite() && positionMillis > 0 && positionMillis < durationMillis * 0.95)
      require(lastEngagementMillis.isFinite() && lastEngagementMillis > 0 && lastEngagementMillis <= System.currentTimeMillis() + 60000)
    }
    return JSONObject().put("slug", slug).put("title", title)
      .put("description", description).put("posterUri", posterUri)
      .put("playbackUri", playbackUri).put("durationMillis", durationMillis.toLong())
      .put("positionMillis", positionMillis.toLong()).put("lastEngagementMillis", lastEngagementMillis.toLong())
  }
}

private fun environment(context: Context): String {
  val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
  return if (info.metaData?.getString("com.google.android.engage.service.ENV") == "PRODUCTION")
    "production" else "verification"
}

private fun result(context: Context, status: String, message: String, count: Int = 0): Bundle =
  Bundle().apply {
    putString("status", status)
    putString("environment", environment(context))
    putString("message", message)
    putInt("count", count)
  }

private fun Bundle.asMap(): Map<String, Any?> = keySet().associateWith { get(it) }

private fun verificationProfile(): AccountProfile =
  AccountProfile.Builder().setAccountId("watch-verification-only").setLocale("en").build()

private fun checkAvailability(context: Context, continuation: Boolean, callback: (Boolean) -> Unit) {
  val client = AppEngagePublishClient(context)
  if (environment(context) == "verification") {
    // The public verifier exposes the Boolean availability toggle, not per-cluster gates.
    client.isServiceAvailable().addOnCompleteListener { task ->
      callback(task.isSuccessful && task.result == true)
    }
    return
  }
  val type = if (continuation) ClusterType.TYPE_CONTINUATION else ClusterType.TYPE_RECOMMENDATION
  val request = ServiceAvailabilityRequest.Builder().addIntendedClusterType(type).build()
  client.isServiceAvailable(request).addOnCompleteListener { task ->
    callback(task.isSuccessful && task.result?.get(type) == true)
  }
}

class GoogleTvHomeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GoogleTvHome")

    AsyncFunction("getStatus") { continuation: Boolean, promise: Promise ->
      val context = requireNotNull(appContext.reactContext)
      val handler = Handler(Looper.getMainLooper())
      var settled = false
      val timeout = Runnable {
        if (!settled) {
          settled = true
          promise.resolve(result(context, "error", "Google TV service check timed out.").asMap())
        }
      }
      handler.postDelayed(timeout, 15000)
      checkAvailability(context, continuation) { available ->
        if (!settled) {
          settled = true
          handler.removeCallbacks(timeout)
          val status = if (available) "available" else "unavailable"
          Log.i("GoogleTvHome", "availability=$status environment=${environment(context)}")
          promise.resolve(result(context, status, if (available) "The requested Google TV Home service is available."
            else "The requested Home service is unavailable for this app or device. Google onboarding may be required.").asMap())
        }
      }
    }

    AsyncFunction("publish") { videos: List<GoogleTvVideo>, consent: Boolean, title: String, continuation: Boolean, promise: Promise ->
      val context = requireNotNull(appContext.reactContext)
      if (Build.VERSION.SDK_INT < 26) {
        promise.resolve(result(context, "unavailable", "This demo requires Android TV 8 or later.").asMap())
      } else if (!consent) {
        promise.resolve(result(context, "blocked", "Adult confirmation and permission to show content on Home are required.").asMap())
      } else if (!continuation && environment(context) == "production") {
        promise.resolve(result(context, "blocked", "Discovery publishing is paused until approved account identity and Google access are configured.").asMap())
      } else if (!operationInFlight.compareAndSet(false, true)) {
        promise.resolve(result(context, "error", "A demo change is still in progress. Try again shortly.").asMap())
      } else {
        try {
          require(title.isNotBlank() && title.length <= 100)
          require(videos.size in (if (continuation) 0..5 else 1..25) && videos.map { it.slug }.distinct().size == videos.size)
          val payload = JSONArray(videos.map { it.toJson(continuation) }).toString()
          val receiver = object : ResultReceiver(Handler(Looper.getMainLooper())) {
            override fun onReceiveResult(resultCode: Int, data: Bundle?) {
              promise.resolve(data?.asMap())
            }
          }
          val intent = Intent(context, GoogleTvHomePublishService::class.java)
            .putExtra("payload", payload).putExtra("reply", receiver)
            .putExtra("continuation", continuation).putExtra("title", title)
          context.startForegroundService(intent)
        } catch (error: Exception) {
          operationInFlight.set(false)
          promise.resolve(result(context, "error", "Cannot publish the demo: ${error.javaClass.simpleName}.").asMap())
        }
      }
    }

    AsyncFunction("remove") { continuation: Boolean, promise: Promise ->
      val context = requireNotNull(appContext.reactContext)
      if (!operationInFlight.compareAndSet(false, true)) {
        promise.resolve(result(context, "error", "A demo change is still in progress. Try again shortly.").asMap())
        return@AsyncFunction
      }
      val handler = Handler(Looper.getMainLooper())
      var settled = false
      val timeout = Runnable {
        if (!settled) {
          settled = true
          promise.resolve(result(context, "error", "Removal was not confirmed. Check access and try again.").asMap())
        }
      }
      handler.postDelayed(timeout, 15000)
      val builder = DeleteClustersRequest.Builder()
        .addClusterType(if (continuation) ClusterType.TYPE_CONTINUATION else ClusterType.TYPE_RECOMMENDATION)
        .setDeleteReason(DeleteReason.DELETE_REASON_LOSS_OF_CONSENT)
        .setSyncAcrossDevices(!continuation)
      if (!continuation) {
        if (environment(context) == "production") {
          operationInFlight.set(false)
          handler.removeCallbacks(timeout)
          promise.resolve(result(context, "blocked", "No production discovery identity is configured.").asMap())
          return@AsyncFunction
        }
        builder.setAccountProfile(verificationProfile())
      }
      val request = builder.build()
      AppEngagePublishClient(context).deleteClusters(request).addOnCompleteListener { task ->
        operationInFlight.set(false)
        if (settled) return@addOnCompleteListener
        settled = true
        handler.removeCallbacks(timeout)
        if (task.isSuccessful) {
          context.getSharedPreferences("google-tv-home-demo", Context.MODE_PRIVATE)
            .edit().remove("publishedAt-${environment(context)}").apply()
        }
        promise.resolve(result(context, if (task.isSuccessful) "removed" else "error",
          if (task.isSuccessful) "Published content removed. Sharing is off."
          else "Google could not remove the demo. Try again when the service is available.").asMap())
      }
    }
  }
}

class GoogleTvHomePublishService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var reply: ResultReceiver? = null
  private var active = false
  private var generation = 0
  private var publishing = false
  private val timeout = Runnable { finish("error", "Publication is not confirmed yet. Wait for the SDK before changing the demo.") }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val receiver = intent?.getParcelableExtra<ResultReceiver>("reply")
    if (active) {
      receiver?.send(0, result(this, "error", "A demo publication is already running."))
      return START_NOT_STICKY
    }
    active = true
    publishing = false
    val requestGeneration = ++generation
    reply = receiver
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel("google-tv-home", "Google TV recommendations", NotificationManager.IMPORTANCE_LOW))
    startForeground(451, Notification.Builder(this, "google-tv-home")
      .setSmallIcon(android.R.drawable.ic_menu_upload)
      .setContentTitle("Updating Google TV Home")
      .setContentText("Updating the content you enabled in Settings.")
      .setOngoing(true).build())
    handler.postDelayed(timeout, 15000)
    val payload = intent?.getStringExtra("payload") ?: "[]"
    val continuation = intent?.getBooleanExtra("continuation", false) == true
    val title = intent?.getStringExtra("title") ?: "Discover Jesus Film"
    checkAvailability(this, continuation) { available ->
      if (!active || generation != requestGeneration) return@checkAvailability
      if (!available) {
        finish("unavailable", "Google TV has not made recommendations available for this app. Nothing was published.")
      } else {
        try {
          val preferences = getSharedPreferences("google-tv-home-demo", Context.MODE_PRIVATE)
          val publishedAtKey = "publishedAt-${environment(this)}"
          if (!continuation && System.currentTimeMillis() - preferences.getLong(publishedAtKey, 0) < 86400000) {
            finish("published", "Today's discovery was already accepted. Google controls home-screen placement.")
            return@checkAvailability
          }
          val entries = JSONArray(payload)
          require(entries.length() in (if (continuation) 0..5 else 1..25))
          require(continuation || environment(this) == "verification")
          val cluster = RecommendationCluster.Builder().setTitle(title)
            .setRecommendationClusterType(RecommendationClusterType.TYPE_PROVIDER_ROW)
          val continuationCluster = ContinuationCluster.Builder().setSyncAcrossDevices(false)
          for (index in 0 until entries.length()) {
            val video = entries.getJSONObject(index)
            val uri = Uri.parse(video.getString("playbackUri"))
            val movie = MovieEntity.Builder()
              .setEntityId("org.jesusfilm.forgetv://watch/${video.getString("slug")}")
              .setName(video.getString("title")).setDescription(video.getString("description"))
              .addGenre("Faith & Scripture")
              .setAvailability(ContentAvailability.AVAILABILITY_AVAILABLE)
              .setDurationMillis(video.getLong("durationMillis"))
              .setPlayBackUri(uri)
              .addPlatformSpecificPlaybackUri(PlatformSpecificUri.Builder()
                .setPlatformType(PlatformType.TYPE_ANDROID_TV).setActionUri(uri).build())
              .addPosterImage(Image.Builder().setImageUri(Uri.parse(video.getString("posterUri")))
                .setImageWidthInPixel(448).setImageHeightInPixel(252).build())
              .setCallToActionText(if (continuation) "Resume" else "Watch now")
            if (continuation) {
              movie.setWatchNextType(WatchNextType.TYPE_CONTINUE)
                .setLastEngagementTimeMillis(video.getLong("lastEngagementMillis"))
                .setLastPlayBackPositionTimeMillis(video.getLong("positionMillis"))
              continuationCluster.addEntity(movie.build())
            } else cluster.addEntity(movie.build())
          }
          publishing = true
          val client = AppEngagePublishClient(this)
          val publication = if (continuation) client.publishContinuationCluster(
            PublishContinuationClusterRequest.Builder().setContinuationCluster(continuationCluster.build()).build()
          ) else client.publishRecommendationClusters(
            PublishRecommendationClustersRequest.Builder().setAccountProfile(verificationProfile())
              .setSyncAcrossDevices(true).addRecommendationCluster(cluster.build()).build()
          )
          publication.addOnCompleteListener { task ->
            operationInFlight.set(false)
            if (task.isSuccessful && !continuation) preferences.edit().putLong(publishedAtKey, System.currentTimeMillis()).apply()
            if (!active || generation != requestGeneration) return@addOnCompleteListener
            if (task.isSuccessful) {
              finish("published", if (environment(this) == "verification")
                "Accepted by the verification service. This does not prove Google TV Home visibility."
                else "Accepted by Google. Home-screen placement is controlled by Google TV.", entries.length())
            } else {
              finish("error", "Google rejected this publication: ${task.exception?.javaClass?.simpleName ?: "UnknownError"}.")
            }
          }
        } catch (error: Exception) {
          publishing = false
          finish("error", "Invalid demo publication: ${error.javaClass.simpleName}.")
        }
      }
    }
    return START_NOT_STICKY
  }

  private fun finish(status: String, message: String, count: Int = 0) {
    if (!active) return
    active = false
    if (!publishing) operationInFlight.set(false)
    handler.removeCallbacks(timeout)
    Log.i("GoogleTvHome", "publication=$status count=$count environment=${environment(this)}")
    reply?.send(0, result(this, status, message, count))
    reply = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (active) finish("error", "Publishing stopped before confirmation. Please check access and retry.")
    handler.removeCallbacks(timeout)
    super.onDestroy()
  }
}
