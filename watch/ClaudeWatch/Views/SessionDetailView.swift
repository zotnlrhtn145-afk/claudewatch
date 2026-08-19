import SwiftUI

/// 세션 화면 = 대화창.
///
/// 예전엔 요약 3~4줄에 [지시]·[전체 로그] 버튼이 있었는데, 손목에서 정작 알고 싶은
/// **주고받은 말**이 한 줄도 안 보였습니다. 이제 이 화면이 곧 대화입니다.
///
/// - 크라운(오른쪽 다이얼)으로 지난 대화를 거슬러 봅니다. watchOS 스크롤에 기본으로 붙습니다.
/// - 마이크는 아래에 고정 — 스크롤해도 자리가 안 바뀝니다.
/// - 도구 실행 줄은 감춥니다. 무엇을 하는 중인지는 🤔 회전이 알려 줍니다.
struct SessionDetailView: View {
    let sessionID: String
    @EnvironmentObject private var model: AppModel

    @State private var detail: SessionDetail?
    @State private var entries: [LogEntry] = []
    @State private var loadError: String?
    @State private var showDictation = false
    /// "작업 중" 을 처음 본 시각. 몇 초째인지 세는 기준입니다.
    @State private var workingSince: Date?
    /// 대화창을 계속 새로 고치는 고리. 화면이 보이는 동안만 돕니다.
    @State private var pollTask: Task<Void, Never>?
    @Environment(\.scenePhase) private var scenePhase

    private var working: Bool {
        detail?.status == .running || detail?.status == .starting
    }

    /// 주고받은 말만. 도구 실행(`tool`)·시스템 줄은 뺍니다.
    private var conversation: [LogEntry] {
        entries.filter { $0.kind == "user" || $0.kind == "assistant" }
    }

    private var echoes: [SentInstruction] { model.sentEcho[sessionID] ?? [] }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    if let loadError {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(loadError).font(.caption2).foregroundStyle(.orange)
                            Button("다시 시도") { Task { await reload() } }
                                .font(.caption2).buttonStyle(.bordered).controlSize(.mini)
                        }
                    }

                    ForEach(conversation) { entry in
                        ChatBubble(entry: entry).id(entry.id)
                    }

                    // 보냈지만 아직 맥 기록에 안 뜬 지시
                    ForEach(echoes) { echo in
                        SendingBubble(text: echo.text).id(echo.id)
                    }

                    // 승인 대기는 대화 흐름 끝에 끼워 넣습니다.
                    if let detail, let pending = detail.pending {
                        ApprovalBlock(detail: detail, pending: pending) { await reload() }
                    }

                    if working {
                        ThinkingIndicator(since: workingSince ?? Date())
                            .padding(.top, 2)
                    }

                    if conversation.isEmpty && echoes.isEmpty && loadError == nil {
                        Text("아직 대화가 없습니다.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }

                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 2)
            }
            .navigationTitle(detail?.name ?? "세션")
            .navigationBarTitleDisplayMode(.inline)
            // 마이크는 아래 고정. 대화를 스크롤해도 자리가 그대로여야 누르기 쉽습니다.
            //
            // safeAreaInset 으로 붙였더니 워치에서 **탭이 안 먹었습니다.**
            // 스크롤 영역 밖에 놓인 뷰가 손가락 입력을 못 받는 경우가 있습니다.
            // 툴바에 넣으면 시스템이 직접 다루므로 확실히 눌립니다.
            .toolbar {
                ToolbarItem(placement: .bottomBar) {
                    Button {
                        showDictation = true
                    } label: {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 19))
                            .foregroundStyle(.black)
                            .frame(width: 42, height: 42)
                            .background(Color(red: 0.99, green: 0.90, blue: 0.31), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .task {
                await reload()
                proxy.scrollTo("bottom", anchor: .bottom)
                startPolling()
            }
            .onDisappear { stopPolling() }
            .onChange(of: scenePhase) { _, phase in
                // 손목을 내리면 멈춥니다. 배터리에서 이게 제일 큽니다.
                if phase == .active { startPolling() } else { stopPolling() }
            }
            .onChange(of: conversation.count) { _, _ in
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .sheet(isPresented: $showDictation) {
                PromptView(sessionID: sessionID) {
                    await reload()
                    await watchForStart()
                }
                .environmentObject(model)
            }
        }
    }

    /// 대화창은 **계속 새로 고쳐야** 합니다.
    ///
    /// 처음엔 화면을 열 때 한 번만 불러왔는데, 그러면 맥에서 새로 오간 말이
    /// 손목에 영영 안 나타납니다. 지시를 보내 놓고 답을 기다리는 동안
    /// 화면이 멈춰 있으면 이 앱을 쓸 이유가 없습니다.
    private func startPolling() {
        stopPolling()
        pollTask = Task {
            while !Task.isCancelled {
                // 일하는 중이면 자주, 조용하면 뜸하게.
                let seconds: UInt64 = working || detail?.status == .waitingApproval ? 3 : 8
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
                if Task.isCancelled { return }
                await reload()
            }
        }
    }

    private func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    /// 지시를 보낸 직후 몇 초는 자주 들여다봅니다.
    /// 맥이 일을 시작하는 게 손목에서 바로 보여야 "들어갔구나" 를 압니다.
    private func watchForStart() async {
        for _ in 0..<10 {
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            await reload()
            if working || detail?.status == .waitingApproval { return }
        }
    }

    private func reload() async {
        do {
            let fresh = try await BridgeClient.shared.detail(sessionID)
            detail = fresh
            // 작업이 시작된 순간을 기억해 뒀다가 경과 시간을 셉니다.
            if fresh.status == .running || fresh.status == .starting {
                if workingSince == nil { workingSince = Date() }
            } else {
                workingSince = nil
            }

            entries = try await BridgeClient.shared.log(sessionID)
            model.clearEcho(sessionID: sessionID, matching: entries)
            loadError = nil
        } catch {
            loadError = BridgeError.from(error).errorDescription
        }
    }
}

/// 승인 블록. 명령어 원문을 넉넉하게 보여 줍니다.
private struct ApprovalBlock: View {
    let detail: SessionDetail
    let pending: PendingApproval
    let onDone: () async -> Void

    @State private var busy = false
    @State private var message: String?

    var body: some View {
        ApprovalFrame(risky: pending.risky) {
            VStack(alignment: .leading, spacing: 6) {
                Text(pending.title ?? "이 명령을 실행할까요?")
                    .font(.caption)
                    .foregroundStyle(pending.risky ? .red : .primary)

                if pending.risky {
                    Text("되돌리기 어려운 명령 — 한 번만 허용됩니다")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                Text(pending.command)
                    .font(.system(.caption2, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                    .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))

                ApprovalButtons(risky: pending.risky, busy: busy,
                                onDecide: { allow, always in decide(allow: allow, always: always) },
                                // 위험한 명령도 더블 탭으로 누를 수 있습니다(사용자 결정).
                                // 그때 눌리는 건 「한 번만 허용」입니다.
                                doubleTapEnabled: true)

                if let message {
                    Text(message).font(.caption2).foregroundStyle(.orange)
                }
            }
        }
    }

    private func decide(allow: Bool, always: Bool) {
        busy = true
        Task {
            do {
                if allow {
                    try await BridgeClient.shared.approve(sessionID: detail.id, approvalID: pending.id, always: always)
                } else {
                    try await BridgeClient.shared.deny(sessionID: detail.id, approvalID: pending.id)
                }
            } catch BridgeError.stale {
                message = "맥에서 이미 처리됐습니다."
            } catch {
                message = BridgeError.from(error).errorDescription
            }
            await onDone()
            busy = false
        }
    }
}
