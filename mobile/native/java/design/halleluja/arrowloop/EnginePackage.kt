package design.halleluja.arrowloop

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

/**
 * What tells React Native that EngineModule exists.
 *
 * A package is the registry entry, and forgetting it is the classic way to end
 * up with `NativeModules.ArrowLoopEngine` being undefined at runtime with
 * nothing in the build saying so. `src/engine.ts` refuses loudly for exactly
 * that reason rather than pretending the engine started.
 *
 * No view managers: this module has no views. The screens are ordinary React
 * Native components, which is the entire point of the rewrite - there is no
 * WebView here and nothing native to draw.
 */
class EnginePackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
        listOf(EngineModule(context))

    override fun createViewManagers(
        context: ReactApplicationContext,
    ): List<ViewManager<out View, out ReactShadowNode<*>>> = emptyList()
}
