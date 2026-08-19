import SwiftUI

/// ④ 음성 지시.
///
/// 위쪽에 말한 내용이 보이고, 아래에 **원형 버튼 두 개** — 말하기(노랑) · 보내기(초록).
/// 예전엔 마이크가 화면 절반을 먹어서 정작 무엇을 말했는지 확인할 자리가 없었습니다.
struct PromptView: View {
    let sessionID: String
    let onSent: () async -> Void

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?

    private var ready: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !sending
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                // 말한 내용 — 보내기 전에 반드시 확인할 수 있어야 합니다.
                // 잘못 들은 채로 맥에서 명령이 실행되면 곤란합니다.
                Text(text.isEmpty ? "마이크를 눌러 말하세요" : text)
                    .font(.footnote)
                    .foregroundStyle(text.isEmpty ? .secondary : .primary)
                    .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
                    .padding(8)
                    .background(Color.gray.opacity(0.18), in: RoundedRectangle(cornerRadius: 12))

                HStack(spacing: 18) {
                    // 말하기 — 누르면 시스템 받아쓰기 화면이 바로 뜹니다.
                    TextFieldLink(prompt: Text("지시")) {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 20))
                            .frame(width: 46, height: 46)
                    } onSubmit: { value in
                        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !clean.isEmpty else { return }
                        text = clean
                    }
                    .buttonStyle(.plain)
                    .background(Color(red: 0.99, green: 0.90, blue: 0.31), in: Circle())
                    .foregroundStyle(.black)

                    // 보내기
                    Button {
                        send()
                    } label: {
                        Group {
                            if sending {
                                ProgressView()
                            } else {
                                Image(systemName: "paperplane.fill").font(.system(size: 18))
                            }
                        }
                        .frame(width: 46, height: 46)
                    }
                    .buttonStyle(.plain)
                    .background(ready ? Color.green : Color.gray.opacity(0.35), in: Circle())
                    .foregroundStyle(ready ? .black : .secondary)
                    .disabled(!ready)
                }

                if sent {
                    Label("보냈습니다", systemImage: "checkmark.circle.fill")
                        .font(.caption2)
                        .foregroundStyle(.green)
                }

                if let error {
                    Text(error).font(.caption2).foregroundStyle(.orange)
                }
            }
            .padding(.horizontal, 4)
        }
        .navigationTitle("지시")
    }

    private func send() {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return }
        sending = true
        error = nil

        Task {
            do {
                try await BridgeClient.shared.prompt(sessionID: sessionID, text: value)
                // 맥 기록에 반영되기까지 몇 초 걸립니다. 그동안 화면이 비어 있으면
                // 보낸 게 맞는지 알 수 없으니 워치가 먼저 띄워 둡니다.
                model.noteSent(sessionID: sessionID, text: value)
                sent = true
                // 대화창으로 바로 돌아갑니다. 보낸 글은 거기 노란 말풍선으로 이미 떠 있고,
                // 이어서 클로드의 답이 라이브로 붙습니다. 여기 오래 머물 이유가 없습니다.
                dismiss()
                await onSent()
            } catch {
                self.error = BridgeError.from(error).errorDescription
            }
            sending = false
        }
    }
}
