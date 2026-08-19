import SwiftUI

/// 대화 말풍선. 카카오톡처럼 **내 말은 오른쪽 노란색**, 클로드 말은 왼쪽 회색.
///
/// 도구 실행(`Bash: …`) 줄은 여기 오지 않습니다 — 손목에서는 주고받은 말만 봅니다.
/// 무엇을 하는 중인지는 아래 `ThinkingIndicator` 가 대신 알려 줍니다.
struct ChatBubble: View {
    let entry: LogEntry

    private var mine: Bool { entry.kind == "user" }

    var body: some View {
        HStack(spacing: 0) {
            if mine { Spacer(minLength: 30) }

            Text(entry.text)
                .font(.caption2)
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(mine ? Color(red: 0.99, green: 0.90, blue: 0.31) : Color.gray.opacity(0.22),
                            in: RoundedRectangle(cornerRadius: 12))
                .foregroundStyle(mine ? Color.black : Color.primary)

            if !mine { Spacer(minLength: 30) }
        }
    }
}

/// 아직 맥 기록에 반영되지 않은, 방금 보낸 지시.
/// 내 말풍선과 같은 모양이되 살짝 흐리고 작은 체크를 답니다.
struct SendingBubble: View {
    let text: String

    var body: some View {
        HStack(alignment: .bottom, spacing: 3) {
            Spacer(minLength: 30)
            Image(systemName: "checkmark")
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
            Text(text)
                .font(.caption2)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(Color(red: 0.99, green: 0.90, blue: 0.31).opacity(0.7),
                            in: RoundedRectangle(cornerRadius: 12))
                .foregroundStyle(.black)
        }
    }
}

/// 일하는 중임을 보여 주는 줄. 앱 로고(🤔)가 돌고 몇 초째인지 올라갑니다.
///
/// 클로드코드 터미널의 회전 표시와 같은 역할입니다. 손목에서 이게 없으면
/// 지시가 들어갔는지, 맥이 멎었는지 구분할 수 없습니다.
struct ThinkingIndicator: View {
    /// 이 화면이 "작업 중" 을 처음 본 시각.
    let since: Date

    @State private var angle: Double = 0
    @State private var now = Date()

    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var elapsed: String {
        let s = max(0, Int(now.timeIntervalSince(since)))
        if s < 60 { return "\(s)초째 생각 중" }
        return "\(s / 60)분 \(s % 60)초째 생각 중"
    }

    var body: some View {
        HStack(spacing: 8) {
            Text("🤔")
                .font(.system(size: 26))
                .rotationEffect(.degrees(angle))
            Text(elapsed)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
        }
        .onAppear {
            // 3초에 한 바퀴. 더 빠르면 어지럽고 느리면 멈춘 것처럼 보입니다.
            withAnimation(.linear(duration: 3).repeatForever(autoreverses: false)) {
                angle = 360
            }
        }
        .onReceive(tick) { now = $0 }
    }
}
