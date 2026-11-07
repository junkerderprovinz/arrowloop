package arrowloop.halleluja.design

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient

/**
 * Raises OkHttp's limit of five requests per host. Every request goes to the
 * engine on loopback, so a few waiting on a remote would hold back every screen.
 */
object EngineHttp : OkHttpClientFactory {
    override fun createNewNetworkModuleClient(): OkHttpClient =
        OkHttpClientProvider.createClientBuilder().build().apply {
            dispatcher.maxRequestsPerHost = 64
        }
}
