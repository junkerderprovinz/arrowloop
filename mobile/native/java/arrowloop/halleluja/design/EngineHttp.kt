package arrowloop.halleluja.design

import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.OkHttpClient

/**
 * Builds the app's HTTP client with room for more requests at once than
 * OkHttp's five per host. Every request goes to the engine on loopback, so
 * those five were all the app had, and a few that wait on an unreachable
 * remote held back every screen.
 */
object EngineHttp : OkHttpClientFactory {
    override fun createNewNetworkModuleClient(): OkHttpClient =
        OkHttpClientProvider.createClientBuilder().build().apply {
            dispatcher.maxRequestsPerHost = 64
        }
}
