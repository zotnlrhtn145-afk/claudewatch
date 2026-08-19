import SwiftUI

/// 음성 지시 입력.
///
/// watchOS 는 서드파티 앱에 마이크 파형이나 실시간 인식 결과를 직접 주지 않습니다.
/// 대신 시스템 입력 화면(받아쓰기·스크리블·이모지)을 띄워 쓰게 합니다.
///
/// 예전엔 TextField 에 포커스를 넘기는 방식이었는데, 그러면 키보드가 먼저 뜨고
/// 마이크까지 한 번 더 눌러야 했습니다. `TextFieldLink` 는 그 화면을 **바로** 띄웁니다.
///
/// 마이크가 눌러도 반응이 없다면 십중팔구 `Info.plist` 의
/// `NSMicrophoneUsageDescription` · `NSSpeechRecognitionUsageDescription` 이 없는 경우입니다.
/// 시스템이 조용히 거부해서 키보드만 동작합니다.
struct DictationField: View {
    let placeholder: String
    @Binding var text: String

    var body: some View {
        VStack(spacing: 8) {
            TextFieldLink(prompt: Text(placeholder)) {
                Image(systemName: "mic.fill")
                    .font(.system(size: 30))
                    .frame(maxWidth: .infinity, minHeight: 62)
            } onSubmit: { value in
                let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !clean.isEmpty else { return }
                text = clean
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)

            if text.isEmpty {
                Text("마이크를 누르고 말하세요")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                // 보낸 내용을 확인하고 고칠 수 있어야 합니다 — 잘못 들은 채로 보내면 곤란합니다.
                Text(text)
                    .font(.footnote)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                    .background(Color.gray.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
            }
        }
    }
}
