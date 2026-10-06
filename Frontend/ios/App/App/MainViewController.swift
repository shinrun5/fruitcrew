import Capacitor

/// Capacitor's view controller plus the app's own native plugins.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        // long-pressing a button or link shouldn't pop up Safari's link preview
        webView?.allowsLinkPreview = false
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(AppleSignInPlugin())
    }
}
