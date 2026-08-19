import SwiftUI
import WatchKit

/// 알림에서 바로 뜨는 승인 화면.
///
/// 알림을 열고 나서 세션을 다시 불러오면 그 사이에 빈 화면이나 스피너가 보입니다.
/// 외부 세션은 대화 기록까지 읽어야 해서 더 느립니다. 손목에서 몇 초를 기다리게
/// 하면 승인이라는 동작 자체가 성립하지 않습니다.
///
/// 그래서 **알림에 실려 온 값만으로** 화면을 먼저 그립니다. 네트워크는 누른 뒤에만 씁니다.
struct ApprovalSheet: View {
    let request: PushApproval
    let onFinished: () -> Void

    @State private var busy = false
    @State private var message: String?

    var body: some View {
        ScrollView {
            ApprovalFrame(risky: request.risky) {
              VStack(alignment: .leading, spacing: 8) {
                Text(request.sessionName)
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if request.risky {
                    Label("되돌리기 어려운 명령", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(.red)
                    Text("한 번만 허용됩니다")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                Text(request.command)
                    .font(.system(.caption2, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                    .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 6))

                ApprovalButtons(risky: request.risky, busy: busy,
                                onDecide: { allow, always in decide(allow: allow, always: always) },
                                doubleTapEnabled: true)

                if let message {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
              }
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle("승인 요청")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func decide(allow: Bool, always: Bool) {
        guard !busy else { return }
        busy = true
        WKInterfaceDevice.current().play(allow ? .success : .directionDown)

        Task {
            do {
                if allow {
                    try await BridgeClient.shared.approve(sessionID: request.sessionID, approvalID: request.approvalID, always: always)
                } else {
                    try await BridgeClient.shared.deny(sessionID: request.sessionID, approvalID: request.approvalID)
                }
                onFinished()
            } catch BridgeError.stale {
                message = "맥에서 이미 처리됐습니다."
                onFinished()
            } catch {
                message = BridgeError.from(error).errorDescription
                WKInterfaceDevice.current().play(.failure)
            }
            busy = false
        }
    }
}
