import UserNotifications
import WatchKit

/// APNs 등록 + 알림에서 바로 승인/거부.
///
/// 알림 액션으로 처리하면 앱을 열 필요가 없습니다 — 기획안에서 제일 중요한 지점입니다.
final class PushManager: NSObject, ObservableObject {
    static let shared = PushManager()

    static let approvalCategory = "APPROVAL"
    private static let approveAction = "APPROVE"
    private static let denyAction = "DENY"

    /// 알림을 눌러서 들어왔을 때 열어 줄 세션.
    @Published var openSessionID: String?

    /// 알림에 실려 온 승인 요청 그대로.
    /// 이게 있으면 세션을 다시 불러오기 전에 승인 화면을 바로 그립니다 —
    /// 손목에서 스피너를 몇 초 보고 있으면 승인이라는 동작이 성립하지 않습니다.
    @Published var pendingApproval: PushApproval?

    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: Self.approvalCategory,
                actions: [
                    UNNotificationAction(identifier: Self.approveAction, title: "승인", options: []),
                    UNNotificationAction(identifier: Self.denyAction, title: "거부", options: [.destructive]),
                ],
                intentIdentifiers: [],
                options: []
            )
        ])

        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                WKApplication.shared().registerForRemoteNotifications()
            }
        }
    }

    /// 기기 토큰을 브리지에 등록합니다. 이게 있어야 맥이 푸시를 보낼 수 있습니다.
    func register(deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task {
            try? await BridgeClient.shared.registerDevice(token: hex)
        }
    }
}

extension PushManager: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        guard let sessionID = info["sessionId"] as? String else { return }
        let approvalID = info["approvalId"] as? String

        // 알림 본문을 눌러 들어온 경우 — 화면을 즉시 그릴 수 있게 내용을 넘깁니다.
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           let approvalID = info["approvalId"] as? String,
           let command = info["command"] as? String {
            let name = (response.notification.request.content.title as String?) ?? "세션"
            let approval = PushApproval(
                sessionID: sessionID,
                approvalID: approvalID,
                sessionName: name,
                command: command,
                risky: (info["risky"] as? Bool) ?? false
            )
            await MainActor.run { self.pendingApproval = approval }
            return
        }

        switch response.actionIdentifier {
        case Self.approveAction, Self.denyAction:
            guard let approvalID else { return }
            let allow = response.actionIdentifier == Self.approveAction
            do {
                if allow {
                    try await BridgeClient.shared.approve(sessionID: sessionID, approvalID: approvalID)
                } else {
                    try await BridgeClient.shared.deny(sessionID: sessionID, approvalID: approvalID)
                }
                WKInterfaceDevice.current().play(allow ? .success : .directionDown)
            } catch {
                // 실패하면 앱에서 다시 처리할 수 있게 세션을 열어 둡니다.
                WKInterfaceDevice.current().play(.failure)
                await MainActor.run { self.openSessionID = sessionID }
            }
        default:
            await MainActor.run { self.openSessionID = sessionID }
        }
    }
}
