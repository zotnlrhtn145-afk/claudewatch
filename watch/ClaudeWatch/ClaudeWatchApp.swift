import SwiftUI
import WatchKit

@main
struct ClaudeWatchApp: App {
    @WKApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel()
    @StateObject private var push = PushManager.shared

    var body: some Scene {
        WindowGroup {
            SessionListView()
                .environmentObject(model)
                .environmentObject(push)
        }
    }
}

final class AppDelegate: NSObject, WKApplicationDelegate {
    func applicationDidFinishLaunching() {
        PushManager.shared.start()
    }

    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        PushManager.shared.register(deviceToken: deviceToken)
    }

    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        // 푸시가 없어도 목록 폴링으로 승인은 가능합니다. 앱을 막지는 않습니다.
    }
}
