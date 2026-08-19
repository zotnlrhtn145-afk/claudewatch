import SwiftUI

/// 세션 상태를 점 하나로. 워치에서는 글자보다 색이 먼저 읽힙니다.
///
/// 일하는 중(`starting`·`running`)이면 **숨쉬듯 깜빡입니다.**
/// 지시를 보내고 나서 아무것도 안 움직이면 들어간 건지 알 수 없습니다.
struct StatusDot: View {
    let status: SessionStatus
    var size: CGFloat = 8

    @State private var pulsing = false

    private var working: Bool { status == .running || status == .starting }

    var body: some View {
        Circle()
            .fill(status.color)
            .frame(width: size, height: size)
            .scaleEffect(working && pulsing ? 1.45 : 1)
            .opacity(working && pulsing ? 0.55 : 1)
            .animation(
                working ? .easeInOut(duration: 0.7).repeatForever(autoreverses: true) : .default,
                value: pulsing
            )
            .onAppear { pulsing = working }
            .onChange(of: status) { _, _ in pulsing = working }
            .accessibilityLabel(status.label)
    }
}

/// 상세 화면 위쪽의 상태 태그.
struct StatusTag: View {
    let status: SessionStatus

    var body: some View {
        HStack(spacing: 4) {
            StatusDot(status: status, size: 6)
            Text(status.label)
                .font(.caption2)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(status.color.opacity(0.2), in: Capsule())
        .foregroundStyle(status.color)
    }
}

/// "지금 일하고 있다" 를 보여 주는 줄.
///
/// 클로드코드 터미널에서 로고가 움직이는 것과 같은 역할입니다.
/// 손목에서는 이게 없으면 지시가 들어갔는지, 맥이 멎었는지 구분이 안 됩니다.
struct WorkingIndicator: View {
    var label: String = "작업 중"

    @State private var phase = 0

    private let timer = Timer.publish(every: 0.45, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 5) {
            HStack(spacing: 3) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(Color.blue)
                        .frame(width: 5, height: 5)
                        .opacity(phase == i ? 1 : 0.28)
                        .scaleEffect(phase == i ? 1.25 : 1)
                }
            }
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .animation(.easeInOut(duration: 0.25), value: phase)
        .onReceive(timer) { _ in phase = (phase + 1) % 3 }
    }
}
