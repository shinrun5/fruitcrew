import Capacitor
import WidgetKit

/// The web app hands the signed-in person's upcoming shifts to the home-screen
/// widget (FruitCrewWidget) through the shared App Group — see
/// Frontend/src/lib/widget.ts for the JSON it writes.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setShifts", returnType: CAPPluginReturnPromise)
    ]

    @objc func setShifts(_ call: CAPPluginCall) {
        UserDefaults(suiteName: "group.com.fruitcrew.app")?.set(call.getString("json") ?? "", forKey: "upcomingShifts")
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
