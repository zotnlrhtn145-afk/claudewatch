import SwiftUI

/// 승인 화면의 버튼 묶음. 목록·상세·알림 세 곳이 같은 모양을 씁니다.
///
/// 색은 사용자가 정한 대로입니다.
///   허용      — 파스텔 노랑 (한 번만)
///   항상 허용  — 진한 노랑 (맥에 영구 저장)
///   거부      — 흰색
///
/// 「항상 허용」은 되돌리기 어려운 명령에는 **띄우지 않습니다.**
/// 손목에서 무심코 누른 게 영구로 남으면, 나중에 그 명령이 조용히 지나갑니다.
struct ApprovalButtons: View {
    let risky: Bool
    let busy: Bool
    /// 두 번째 인자가 참이면 「항상 허용」입니다.
    let onDecide: (_ allow: Bool, _ always: Bool) -> Void
    /// 더블 탭으로 누를 수 있는지 (위험한 명령이면 꺼집니다).
    var doubleTapEnabled: Bool = false

    private let pastel = Color(red: 0.99, green: 0.93, blue: 0.63)
    private let yellow = Color(red: 0.99, green: 0.84, blue: 0.24)

    /// 더블 탭이 누를 버튼.
    ///
    /// 「항상 허용」이 있으면 그쪽이 기본입니다 — 개발 중에는 같은 명령이 반복되므로
    /// 한 번 허용해 두는 편이 손목을 덜 괴롭힙니다. 사용자가 그렇게 정했습니다.
    /// 되돌리기 어려운 명령에는 「항상 허용」 자체가 없고 더블 탭도 꺼집니다.
    private var alwaysIsPrimary: Bool { !risky }

    var body: some View {
        VStack(spacing: 6) {
            Button("허용") { onDecide(true, false) }
                .buttonStyle(PillButton(fill: pastel, selected: doubleTapEnabled && !alwaysIsPrimary))
                .doubleTapPrimary(doubleTapEnabled && !alwaysIsPrimary)

            if !risky {
                Button("항상 허용") { onDecide(true, true) }
                    .buttonStyle(PillButton(fill: yellow, selected: doubleTapEnabled && alwaysIsPrimary))
                    .doubleTapPrimary(doubleTapEnabled && alwaysIsPrimary)
            }

            Button("거부") { onDecide(false, false) }
                .buttonStyle(PillButton(fill: .white))

            if doubleTapEnabled {
                // 손목 동작이 무엇을 누를지 미리 알려 줍니다.
                // 모르고 두 번 맞대면 의도하지 않은 걸 누르게 됩니다.
                Label(alwaysIsPrimary ? "더블 탭 → 항상 허용" : "더블 탭 → 허용",
                      systemImage: "hand.tap")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
            }
        }
        .disabled(busy)
        .opacity(busy ? 0.5 : 1)
    }
}

/// 모서리가 둥근 꽉 찬 버튼.
private struct PillButton: ButtonStyle {
    let fill: Color
    /// 더블 탭이 누를 버튼이면 테두리를 둘러 표시합니다.
    var selected: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.footnote)
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity, minHeight: 34)
            .background(fill.opacity(configuration.isPressed ? 0.7 : 1),
                        in: RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.cyan, lineWidth: selected ? 2.5 : 0)
            )
    }
}

/// 승인 요청 전체를 감싸는 틀. 겉 테두리를 노랗게 둘러 눈에 띄게 합니다.
struct ApprovalFrame<Content: View>: View {
    let risky: Bool
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(9)
            .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(risky ? Color.red : Color(red: 0.99, green: 0.84, blue: 0.24),
                            lineWidth: 2.5)
            )
    }
}
