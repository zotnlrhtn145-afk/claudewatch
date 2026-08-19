import SwiftUI

/// 엄지+검지 더블 탭으로 누를 수 있게 표시합니다.
///
/// watchOS 가 앱에 열어 주는 손 제스처는 **더블 탭 하나뿐**입니다.
/// 손목 돌리기·꽉 쥐기 같은 나머지는 손쉬운 사용 전용이라 앱이 쓸 수 없습니다.
///
/// 조건:
///   - 기기: Apple Watch Series 9 / Ultra 2 이상
///   - OS: watchOS 11+ (이 앱의 최소는 10.0 이라 분기합니다)
///
/// 조건이 안 되는 기기에서는 아무 일도 일어나지 않습니다 — 화면을 눌러 승인하면 됩니다.
extension View {
    @ViewBuilder
    func doubleTapPrimary(_ enabled: Bool) -> some View {
        if #available(watchOS 11.0, *) {
            handGestureShortcut(.primaryAction, isEnabled: enabled)
        } else {
            self
        }
    }
}
