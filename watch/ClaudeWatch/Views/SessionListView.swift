import SwiftUI

/// ① 메인 화면. 세션 목록 + 승인 대기는 여기서 바로 처리합니다.
struct SessionListView: View {
    @EnvironmentObject private var model: AppModel
    @EnvironmentObject private var push: PushManager
    @Environment(\.scenePhase) private var scenePhase

    @State private var showNewSession = false
    @State private var showSettings = false
    @State private var pushedSessionID: String?

    var body: some View {
        NavigationStack {
            List {
                if let error = model.connectionError {
                    ConnectionBanner(
                        error: error,
                        staleText: model.isShowingStaleData ? model.lastSyncedText : nil,
                        onSettings: { showSettings = true },
                        onRetry: { Task { await model.retryNow() } }
                    )
                }

                ForEach(model.sessions) { session in
                    SessionRow(session: session)
                }
                // 낡은 화면은 흐리게 — 지금 상태라고 착각하고 승인을 누르면 안 됩니다.
                .opacity(model.isShowingStaleData ? 0.55 : 1)

                if model.sessions.isEmpty && model.connectionError == nil && !model.isLoading {
                    Text("아직 세션이 없습니다.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Button {
                    showNewSession = true
                } label: {
                    Label("새 세션", systemImage: "plus")
                }
                .disabled(!Settings.shared.isConfigured)
            }
            .navigationTitle("클로드워치")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showNewSession) {
                NewSessionView()
                    .environmentObject(model)
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
                    .environmentObject(model)
            }
            .navigationDestination(item: $pushedSessionID) { id in
                SessionDetailView(sessionID: id)
                    .environmentObject(model)
            }
            // 알림에서 들어오면 세션을 불러오기 전에 승인 화면을 먼저 띄웁니다.
            .navigationDestination(item: $push.pendingApproval) { request in
                ApprovalSheet(request: request) {
                    push.pendingApproval = nil
                    Task { await model.refresh() }
                }
            }
        }
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in
            // 화면이 안 보이면 폴링을 멈춥니다 — 워치 배터리에서 이게 제일 큽니다.
            if phase == .active { model.startPolling() } else { model.stopPolling() }
        }
        .onChange(of: push.pendingApproval) { _, request in
            // 승인 화면이 뜨면 목록으로 가는 이동은 취소합니다 — 둘이 겹치면 안 됩니다.
            if request != nil { pushedSessionID = nil }
        }
        .onChange(of: push.openSessionID) { _, id in
            guard let id else { return }
            pushedSessionID = id
            push.openSessionID = nil
        }
    }
}

/// 끊겼을 때 목록 맨 위에 뜨는 줄.
/// 무엇이 끊겼는지(워치냐 맥이냐)와, 보고 있는 화면이 언제 적인지까지 알려 줍니다.
private struct ConnectionBanner: View {
    let error: BridgeError
    /// 낡은 목록을 보고 있으면 "2분 전" 같은 문구. 최신이면 nil.
    let staleText: String?
    let onSettings: () -> Void
    let onRetry: () -> Void

    /// 설정을 고쳐야 풀리는 오류인지, 그냥 기다리면 되는 오류인지.
    private var needsSettings: Bool {
        switch error {
        case .notConfigured, .badURL: return true
        case let .http(code, _): return code == 401
        default: return false
        }
    }

    private var icon: String {
        switch error {
        case .offline: return "antenna.radiowaves.left.and.right.slash"
        case .macUnreachable, .timedOut: return "desktopcomputer.trianglebadge.exclamationmark"
        default: return "exclamationmark.triangle.fill"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Image(systemName: icon)
                Text(error.errorDescription ?? "연결에 문제가 있습니다.")
                    .font(.caption2)
                    .multilineTextAlignment(.leading)
            }
            .foregroundStyle(.orange)

            if let hint = error.hint {
                Text(hint)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            if let staleText {
                Text("아래는 \(staleText) 화면입니다.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }

            Button(needsSettings ? "설정 열기" : "다시 시도") {
                if needsSettings { onSettings() } else { onRetry() }
            }
            .font(.caption2)
            .buttonStyle(.bordered)
            .controlSize(.mini)
        }
        .padding(.vertical, 2)
    }
}

/// 세션 카드 하나. 승인 대기면 카드 안에서 바로 끝낼 수 있어야 합니다.
private struct SessionRow: View {
    let session: SessionSummary
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            NavigationLink {
                SessionDetailView(sessionID: session.id)
                    .environmentObject(model)
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        StatusDot(status: session.status)
                        Text(session.name)
                            .font(.footnote)
                            .lineLimit(2)
                        Spacer(minLength: 4)
                        Text(session.updatedAt.elapsedShort)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    // 일하는 중이면 움직여서 보여 줍니다.
                    if session.status == .running || session.status == .starting {
                        WorkingIndicator(label: session.status == .starting ? "시작하는 중" : "작업 중")
                    }

                    // 맥 터미널에서 도는 세션. 승인은 되지만 지시는 못 보냅니다.
                    if session.isExternal {
                        HStack(spacing: 4) {
                            Image(systemName: "desktopcomputer")
                            Text("맥에서 실행 중")
                            Spacer(minLength: 0)
                            Text(session.folder).lineLimit(1)
                        }
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                    }
                }
            }
            .buttonStyle(.plain)

            if let pending = session.pending {
                InlineApproval(session: session, pending: pending)
            }
        }
        .padding(.vertical, 2)
        .listRowBackground(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.gray.opacity(session.isExternal ? 0.10 : 0.18))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.orange, lineWidth: session.pending == nil ? 0 : 2)
                )
        )
    }
}

/// 목록 안에서 바로 누르는 승인/거부. 탭 한 번으로 끝나야 합니다.
private struct InlineApproval: View {
    let session: SessionSummary
    let pending: PendingApproval
    @EnvironmentObject private var model: AppModel

    private var busy: Bool { model.busyApprovals.contains(pending.id) }

    var body: some View {
        ApprovalFrame(risky: pending.risky) {
            VStack(alignment: .leading, spacing: 6) {
                if pending.risky {
                    Label("되돌리기 어려운 명령", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption2)
                        .foregroundStyle(.red)
                    Text("한 번만 허용됩니다")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                Text(pending.command)
                    .font(.system(.caption2, design: .monospaced))
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                    .background(Color.black.opacity(0.35), in: RoundedRectangle(cornerRadius: 8))

                ApprovalButtons(
                    risky: pending.risky,
                    busy: busy,
                    onDecide: { allow, always in
                        Task { await model.decide(session: session, approval: pending, allow: allow, always: always) }
                    },
                    doubleTapEnabled: model.doubleTapApprovalSessionID == session.id
                )
            }
        }
    }
}
