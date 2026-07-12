import UIKit
import Capacitor

// App-local Capacitor plugins must be registered on the bridge by hand
// (Capacitor 5+ dropped runtime plugin scanning). Main.storyboard instantiates
// this subclass instead of CAPBridgeViewController.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MemoryProbePlugin())
    }
}
