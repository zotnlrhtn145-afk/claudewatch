import SwiftUI

/// 브리지 서버가 내려 주는 세션 상태. 워치에서는 색 하나로 읽힙니다.
enum SessionStatus: String, Codable {
    case starting
    case running
    case waitingApproval = "waiting_approval"
    case idle
    case done
    case error
    case unknown

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        // 서버가 새 상태를 추가해도 앱이 통째로 디코딩 실패하면 안 됩니다.
        self = SessionStatus(rawValue: raw) ?? .unknown
    }

    var color: Color {
        switch self {
        case .running, .starting: return .blue
        case .waitingApproval: return .orange
        case .idle, .done: return .green
        case .error: return .red
        case .unknown: return .gray
        }
    }

    var label: String {
        switch self {
        case .starting: return "시작 중"
        case .running: return "실행 중"
        case .waitingApproval: return "승인 대기"
        case .idle: return "대기"
        case .done: return "완료"
        case .error: return "오류"
        case .unknown: return "알 수 없음"
        }
    }
}

struct PendingApproval: Codable, Identifiable, Hashable {
    let id: String
    let toolName: String
    let command: String
    var title: String?
    let risky: Bool
    let requestedAt: Double
}

struct SessionSummary: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let project: String
    let status: SessionStatus
    let createdAt: Double
    let updatedAt: Double
    var pending: PendingApproval?
    /// 맥에서 따로 돌고 있는 세션. 볼 수만 있고 승인·지시는 못 합니다.
    var external: Bool?
    var claudeSessionId: String?

    var isExternal: Bool { external == true }

    /// 폴더 이름만. 워치 화면에 전체 경로는 안 들어갑니다.
    var folder: String {
        (project as NSString).lastPathComponent
    }
}

struct SessionDetail: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let project: String
    let status: SessionStatus
    let createdAt: Double
    let updatedAt: Double
    var pending: PendingApproval?
    let summary: [String]
    let logCount: Int
    var error: String?
    var claudeSessionId: String?
    let driver: String
}

struct Project: Codable, Identifiable, Hashable {
    let name: String
    let path: String
    let display: String
    var id: String { path }
}

struct LogEntry: Codable, Identifiable, Hashable {
    let t: Double
    let kind: String
    let text: String
    var id: String { "\(t)-\(kind)-\(text.hashValue)" }

    var icon: String {
        switch kind {
        case "user": return "person.fill"
        case "assistant": return "sparkle"
        case "tool": return "wrench.fill"
        case "result": return "checkmark.circle.fill"
        default: return "info.circle"
        }
    }
}

extension Double {
    /// 워치 목록에 들어갈 경과 시간. "3분", "2시간" 처럼 아주 짧게.
    var elapsedShort: String {
        let seconds = max(0, Date().timeIntervalSince1970 - self / 1000)
        if seconds < 60 { return "방금" }
        if seconds < 3600 { return "\(Int(seconds / 60))분" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))시간" }
        return "\(Int(seconds / 86_400))일"
    }
}

/// 알림에 실려 온 승인 요청.
/// 브리지가 푸시 본문에 같이 실어 보내므로, 네트워크를 다시 타지 않고 화면을 그릴 수 있습니다.
struct PushApproval: Identifiable, Hashable {
    let sessionID: String
    let approvalID: String
    let sessionName: String
    let command: String
    let risky: Bool

    var id: String { approvalID }
}

/// 워치에서 방금 보낸 지시. 맥 기록에 반영되기 전까지만 화면에 남습니다.
struct SentInstruction: Identifiable, Hashable {
    let text: String
    let at: Date
    var id: String { "\(at.timeIntervalSince1970)-\(text.hashValue)" }
}
