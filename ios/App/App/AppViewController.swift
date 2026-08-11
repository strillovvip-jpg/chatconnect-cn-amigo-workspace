import UIKit
import Capacitor

final class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        KeyValueStore.standard["serverBasePath"] = nil as String?
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
        syncSafeAreaInsets()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        syncSafeAreaInsets()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        syncSafeAreaInsets()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        syncSafeAreaInsets()
    }

    private func syncSafeAreaInsets() {
        guard let webView else { return }
        let insets = view.safeAreaInsets
        let script = """
        (function() {
          var root = document.documentElement;
          if (!root) return;
          root.style.setProperty('--app-safe-area-top', '\(insets.top)px');
          root.style.setProperty('--app-safe-area-right', '\(insets.right)px');
          root.style.setProperty('--app-safe-area-bottom', '\(insets.bottom)px');
          root.style.setProperty('--app-safe-area-left', '\(insets.left)px');
        })();
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
}
