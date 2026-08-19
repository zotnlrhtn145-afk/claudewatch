import SwiftUI

/// 브리지 주소와 토큰.
///
/// 워치에서 32자 토큰을 손으로 넣는 건 사실상 불가능하고 받아쓰기도 안 됩니다.
/// 그래서 **숫자 8자리 페어링 코드**를 기본 경로로 두고, 직접 입력은 접어 둡니다.
struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var settings = Settings.shared

    @State private var code = ""
    @State private var pairing = false
    @State private var checking = false
    @State private var result: String?
    @State private var showManual = false

    private var paired: Bool { !settings.token.isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                if paired {
                    Label("연결 준비됨", systemImage: "checkmark.circle.fill")
                        .font(.footnote)
                        .foregroundStyle(.green)
                    Text(settings.host)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                } else {
                    pairingSection
                }

                Button {
                    check()
                } label: {
                    if checking {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("연결 확인").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!settings.isConfigured || checking)

                if let result {
                    Text(result)
                        .font(.caption2)
                        .foregroundStyle(result.hasPrefix("연결됨") ? .green : .orange)
                }

                // 코드가 안 될 때를 위한 비상구. 평소엔 접어 둡니다.
                // (watchOS 에는 DisclosureGroup 이 없어서 버튼으로 여닫습니다.)
                Button(showManual ? "직접 입력 닫기" : "직접 입력") {
                    showManual.toggle()
                }
                .font(.caption2)
                .buttonStyle(.bordered)
                .controlSize(.mini)

                if showManual {
                    Text("브리지 주소")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    TextField("맥이름.tailnet.ts.net", text: $settings.host)
                        .font(.footnote)

                    Text("토큰")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    SecureField("BRIDGE_TOKEN", text: $settings.token)
                        .font(.footnote)
                }
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle("설정")
    }

    /// 맥에서 발급한 숫자 코드를 받아 토큰을 가져옵니다.
    @ViewBuilder
    private var pairingSection: some View {
        Text("맥에 뜬 숫자 8자리를 넣으세요")
            .font(.caption2)
            .foregroundStyle(.secondary)

        TextField("00000000", text: $code)
            .font(.system(.title3, design: .monospaced))

        Button {
            pair()
        } label: {
            if pairing {
                ProgressView().frame(maxWidth: .infinity)
            } else {
                Text("연결하기").frame(maxWidth: .infinity)
            }
        }
        .buttonStyle(.borderedProminent)
        .tint(.green)
        .disabled(code.count < 8 || pairing)
    }

    private func pair() {
        pairing = true
        result = nil
        Task {
            do {
                let token = try await BridgeClient.shared.pair(code: code, host: settings.host)
                settings.token = token
                code = ""
                result = "연결됨 · 토큰을 받았습니다"
                await model.refresh()
            } catch {
                result = BridgeError.from(error).errorDescription
            }
            pairing = false
        }
    }

    private func check() {
        checking = true
        result = nil
        Task {
            do {
                let sessions = try await BridgeClient.shared.sessions()
                result = "연결됨 · 세션 \(sessions.count)개"
                await model.refresh()
            } catch {
                result = BridgeError.from(error).errorDescription
            }
            checking = false
        }
    }
}
