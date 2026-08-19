import SwiftUI

/// ⑤ 새 세션. 프로젝트를 고르고 첫 지시를 말하면 됩니다.
struct NewSessionView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var projects: [Project] = []
    @State private var selected: Project?
    @State private var firstPrompt = ""
    @State private var starting = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("프로젝트")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                if projects.isEmpty {
                    ProgressView().frame(maxWidth: .infinity)
                } else {
                    Picker("프로젝트", selection: $selected) {
                        ForEach(projects) { project in
                            Text(project.name).tag(Project?.some(project))
                        }
                    }
                    .labelsHidden()
                    .frame(height: 58)
                }

                Text("첫 지시")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                DictationField(placeholder: "무엇을 시킬까요?", text: $firstPrompt)

                Button {
                    start()
                } label: {
                    if starting {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        Text("세션 시작").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(!canStart)

                if let error {
                    Text(error).font(.caption2).foregroundStyle(.orange)
                }

                Text("핸드폰·데스크톱에도 자동으로 나타나요")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 2)
        }
        .navigationTitle("새 세션")
        .task { await loadProjects() }
    }

    private var canStart: Bool {
        selected != nil
            && !firstPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !starting
    }

    private func loadProjects() async {
        do {
            projects = try await BridgeClient.shared.projects()
            selected = projects.first
        } catch {
            self.error = BridgeError.from(error).errorDescription
        }
    }

    private func start() {
        guard let project = selected else { return }
        starting = true
        error = nil

        Task {
            do {
                _ = try await BridgeClient.shared.create(
                    project: project.path,
                    firstPrompt: firstPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
                )
                await model.refresh()
                dismiss()
            } catch {
                self.error = BridgeError.from(error).errorDescription
            }
            starting = false
        }
    }
}
