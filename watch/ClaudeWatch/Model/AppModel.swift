import SwiftUI
import WatchKit

/// 화면들이 함께 보는 상태.
@MainActor
final class AppModel: ObservableObject {
    @Published var sessions: [SessionSummary] = []
    @Published var isLoading = false
    /// 맥이 꺼졌거나 네트워크가 끊겼을 때 목록 위에 띄울 오류.
    @Published var connectionError: BridgeError?
    /// 승인/거부를 누른 직후 두 번 눌리지 않게 잠급니다.
    @Published var busyApprovals: Set<String> = []
    /// 마지막으로 목록을 실제로 받아 온 시각. 끊긴 동안 화면이 얼마나 낡았는지 보여 줍니다.
    @Published var lastSyncedAt: Date?

    /// 방금 보낸 지시. 맥의 기록에 반영되기까지 몇 초 걸리는데,
    /// 그동안 화면에 아무것도 없으면 보낸 게 맞는지 알 수 없습니다.
    /// 그래서 워치가 먼저 띄워 두고, 실제 기록에 나타나면 지웁니다.
    @Published private(set) var sentEcho: [String: [SentInstruction]] = [:]

    private var pollTask: Task<Void, Never>?
    /// 연속 실패 횟수 — 맥이 꺼져 있는데 6초마다 두드리면 워치 배터리만 녹습니다.
    private var failureStreak = 0

    var waitingCount: Int {
        sessions.filter { $0.status == .waitingApproval }.count
    }

    /// 끊긴 채로 남아 있는 낡은 목록을 보고 있는 상태.
    var isShowingStaleData: Bool {
        connectionError != nil && !sessions.isEmpty
    }

    /// 더블 탭(엄지+검지)으로 승인할 수 있는 세션.
    ///
    /// 한 화면에 primary action 은 하나만 둘 수 있어서, 승인 대기가 여럿이면
    /// **맨 위 하나만** 잡습니다. 아래 항목으로 넘기지 않습니다 — 화면에 보이는
    /// 카드와 손목 동작이 승인하는 대상이 어긋나는 게 제일 나쁜 실패입니다.
    ///
    /// 위험한 명령도 더블 탭 대상입니다(사용자 결정). 다만 그때 눌리는 건
    /// **「한 번만 허용」** 입니다 — 「항상 허용」은 위험한 명령에 아예 뜨지 않습니다.
    var doubleTapApprovalSessionID: String? {
        // 방금 하나 승인했으면 잠깐 아무것도 잡지 않습니다. 아래 startCooldown() 설명 참고.
        guard !doubleTapCoolingDown else { return nil }
        return sessions.first(where: { $0.pending != nil })?.id
    }

    /// 승인 직후의 짧은 무효 구간.
    @Published private var doubleTapCoolingDown = false
    private var cooldownTask: Task<Void, Never>?

    /// 승인 대기가 여러 개 쌓여 있을 때, 연달아 두 번 맞대면
    /// 목록이 갱신되면서 **읽지도 않은 다음 승인이 통과합니다.**
    /// 손목에서 뭐가 승인됐는지 모른 채 지나가는 게 제일 위험해서, 승인 뒤 잠깐 막습니다.
    /// 화면을 직접 누르는 건 그대로 됩니다 — 그건 보고 누르는 거니까요.
    private func startCooldown() {
        cooldownTask?.cancel()
        doubleTapCoolingDown = true
        cooldownTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run { self?.doubleTapCoolingDown = false }
        }
    }

    /// "2분 전" — 배너에 붙여 언제 적 화면인지 알려 줍니다.
    var lastSyncedText: String? {
        guard let lastSyncedAt else { return nil }
        let seconds = Int(Date().timeIntervalSince(lastSyncedAt))
        if seconds < 60 { return "방금 전" }
        if seconds < 3600 { return "\(seconds / 60)분 전" }
        return "\(seconds / 3600)시간 전"
    }

    /// 지시를 보낸 직후 화면에 먼저 띄웁니다.
    func noteSent(sessionID: String, text: String) {
        var list = sentEcho[sessionID] ?? []
        list.append(SentInstruction(text: text, at: Date()))
        sentEcho[sessionID] = list
    }

    /// 실제 대화 기록에 나타났으면 임시 표시를 걷어냅니다.
    func clearEcho(sessionID: String, matching entries: [LogEntry]) {
        guard let list = sentEcho[sessionID], !list.isEmpty else { return }
        let landed = entries.map(\.text)
        let remaining = list.filter { echo in
            // 전달 문구가 앞에 붙어 오므로 포함 여부로 봅니다.
            !landed.contains { $0.contains(echo.text) }
        }
        if remaining.count != list.count { sentEcho[sessionID] = remaining }
    }

    func refresh() async {
        guard Settings.shared.isConfigured else {
            connectionError = .notConfigured
            sessions = []
            return
        }

        isLoading = sessions.isEmpty
        do {
            sessions = try await BridgeClient.shared.sessions()
            connectionError = nil
            lastSyncedAt = Date()
            failureStreak = 0
        } catch {
            // 목록은 지우지 않습니다. 낡았어도 뭐가 돌고 있었는지는 보이는 편이 낫습니다.
            connectionError = BridgeError.from(error)
            failureStreak += 1
        }
        isLoading = false
    }

    /// 다음 폴링까지 몇 초 쉴지.
    ///
    /// 푸시가 급한 일(승인 요청)을 알려 주므로 폴링은 화면을 맞추는 용도입니다.
    /// 그래서 볼 게 없으면 과감히 느리게 갑니다 — 워치 배터리는 이 주기가 거의 전부입니다.
    private var pollInterval: TimeInterval {
        if failureStreak > 0 {
            // 맥이 꺼진 경우: 6 → 12 → 24 → 30초로 물러섭니다.
            return min(30, 6 * pow(2, Double(failureStreak - 1)))
        }
        if sessions.contains(where: { $0.status == .waitingApproval }) { return 3 }
        if sessions.contains(where: { $0.status == .running || $0.status == .starting }) { return 6 }
        // 전부 대기/완료 — 손목에서 볼 게 바뀌지 않습니다.
        return 20
    }

    /// 화면이 보이는 동안에만 돕니다.
    func startPolling() {
        stopPolling()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                guard let interval = self?.pollInterval else { return }
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    /// 배너의 [다시 시도] — 물러서 있던 주기를 즉시 되돌립니다.
    func retryNow() async {
        failureStreak = 0
        await refresh()
        startPolling()
    }

    func decide(session: SessionSummary, approval: PendingApproval, allow: Bool, always: Bool = false) async {
        guard !busyApprovals.contains(approval.id) else { return }
        busyApprovals.insert(approval.id)
        defer { busyApprovals.remove(approval.id) }

        // 다음 승인이 손목 동작만으로 연달아 통과하지 않게 잠깐 막습니다.
        startCooldown()

        // 손목에서 누른 게 실제로 전달됐다는 느낌을 바로 줍니다.
        WKInterfaceDevice.current().play(allow ? .success : .directionDown)

        do {
            if allow {
                try await BridgeClient.shared.approve(sessionID: session.id, approvalID: approval.id, always: always)
            } else {
                try await BridgeClient.shared.deny(sessionID: session.id, approvalID: approval.id)
            }
        } catch BridgeError.stale {
            // 맥에서 이미 처리된 경우 — 조용히 목록만 맞춥니다.
        } catch {
            connectionError = BridgeError.from(error)
            WKInterfaceDevice.current().play(.failure)
        }

        await refresh()
    }
}
