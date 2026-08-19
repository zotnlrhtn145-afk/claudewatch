import Foundation

enum BridgeError: LocalizedError {
    case notConfigured
    case badURL
    case http(Int, String)
    case stale
    /// 워치가 아예 네트워크에 못 나갑니다 (LTE 끊김, 비행기 모드).
    case offline
    /// 네트워크는 되는데 맥이 안 받습니다 (맥 꺼짐, 브리지 안 떠 있음, Tailscale 끊김).
    case macUnreachable
    case timedOut

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "브리지 주소와 토큰을 먼저 넣어 주세요."
        case .badURL: return "브리지 주소 모양이 이상합니다."
        case .stale: return "이미 처리된 요청입니다."
        case .offline: return "워치가 네트워크에 연결돼 있지 않습니다."
        case .macUnreachable: return "맥에 닿지 않습니다. 켜져 있는지 확인해 주세요."
        case .timedOut: return "맥이 응답하지 않습니다."
        case let .http(code, message):
            if code == 401 { return "토큰이 맞지 않습니다." }
            return message.isEmpty ? "브리지 오류 (\(code))" : message
        }
    }

    /// 배너에 함께 띄울 짧은 안내. 워치 화면이라 한 줄을 넘기지 않습니다.
    var hint: String? {
        switch self {
        case .offline: return "LTE 신호를 확인해 주세요."
        case .macUnreachable: return "맥 절전이나 Tailscale 연결을 확인해 주세요."
        case .timedOut: return "잠시 후 다시 시도합니다."
        case .notConfigured, .badURL: return "탭해서 설정 열기"
        case let .http(code, _): return code == 401 ? "탭해서 토큰 다시 넣기" : nil
        case .stale: return nil
        }
    }

    /// URLSession 이 던진 오류를 워치가 읽을 말로 옮깁니다.
    /// "연결 실패" 한 마디로 뭉치면 맥을 켜야 하는지 신호를 찾아야 하는지 알 수 없습니다.
    static func from(_ error: Error) -> BridgeError {
        if let bridge = error as? BridgeError { return bridge }
        guard let url = error as? URLError else { return .macUnreachable }

        switch url.code {
        case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed,
             .internationalRoamingOff, .callIsActive:
            return .offline
        case .timedOut:
            return .timedOut
        default:
            // cannotConnectToHost / cannotFindHost / hostUnreachable 등 — 맥 쪽 문제입니다.
            return .macUnreachable
        }
    }
}

/// 브리지가 오류일 때 내려 주는 몸통.
private struct FailureBody: Decodable {
    let error: String
}

/// 브리지 서버와 이야기하는 유일한 통로.
struct BridgeClient {
    static let shared = BridgeClient()

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        // LTE 로 붙으므로 넉넉하게. 그래도 무한정 기다리지는 않습니다.
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        // 끊겼으면 기다리지 말고 바로 실패시킵니다. 기다리면 배너가 안 뜨고
        // 폴링 루프가 통째로 멈춰서, 사용자는 최신 화면을 보고 있다고 착각합니다.
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    private let decoder = JSONDecoder()

    // MARK: - 읽기

    func sessions() async throws -> [SessionSummary] {
        struct Wrapper: Decodable { let sessions: [SessionSummary] }
        return try await get("/sessions", as: Wrapper.self).sessions
    }

    func detail(_ id: String) async throws -> SessionDetail {
        try await get("/sessions/\(id)", as: SessionDetail.self)
    }

    func log(_ id: String, limit: Int = 120) async throws -> [LogEntry] {
        struct Wrapper: Decodable { let log: [LogEntry] }
        return try await get("/sessions/\(id)/log?limit=\(limit)", as: Wrapper.self).log
    }

    func projects() async throws -> [Project] {
        struct Wrapper: Decodable { let projects: [Project] }
        return try await get("/projects", as: Wrapper.self).projects
    }

    // MARK: - 쓰기

    /// - Parameter always: 참이면 이 명령을 맥에 「항상 허용」으로 적어 둡니다(영구).
    @discardableResult
    func approve(sessionID: String, approvalID: String, always: Bool = false) async throws -> SessionDetail {
        try await postJSON(
            "/sessions/\(sessionID)/approve",
            body: ["approvalId": approvalID, "always": always],
            as: SessionDetail.self
        )
    }

    @discardableResult
    func deny(sessionID: String, approvalID: String) async throws -> SessionDetail {
        try await post("/sessions/\(sessionID)/deny", body: ["approvalId": approvalID], as: SessionDetail.self)
    }

    @discardableResult
    func prompt(sessionID: String, text: String) async throws -> SessionDetail {
        try await post("/sessions/\(sessionID)/prompt", body: ["text": text], as: SessionDetail.self)
    }

    func create(project: String, firstPrompt: String) async throws -> SessionDetail {
        try await post("/sessions", body: ["project": project, "firstPrompt": firstPrompt], as: SessionDetail.self)
    }

    /// 페어링 코드 → 진짜 토큰.
    /// 토큰을 넣기 전에 부르는 유일한 호출이라, 인증 헤더 없이 나갑니다.
    func pair(code: String, host: String) async throws -> String {
        struct Wrapper: Decodable { let token: String }
        let clean = host.trimmingCharacters(in: .whitespaces)
        let withScheme = clean.contains("://") ? clean : "https://\(clean)"
        guard let base = URL(string: withScheme), let url = URL(string: "/pair", relativeTo: base) else {
            throw BridgeError.badURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["code": code])
        return try await send(request, as: Wrapper.self).token
    }

    func registerDevice(token: String) async throws {
        struct Wrapper: Decodable { let ok: Bool }
        _ = try await post("/devices", body: ["token": token], as: Wrapper.self)
    }

    // MARK: - 바탕

    private func request(_ path: String, method: String) throws -> URLRequest {
        let settings = Settings.shared
        guard settings.isConfigured else { throw BridgeError.notConfigured }
        guard let base = settings.baseURL, let url = URL(string: path, relativeTo: base) else {
            throw BridgeError.badURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(settings.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func send<T: Decodable>(_ request: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw BridgeError.from(error)
        }
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0

        guard (200..<300).contains(code) else {
            // 409 는 "그새 상황이 바뀌었다" 는 뜻입니다 — 워치는 목록만 새로 받으면 됩니다.
            if code == 409 { throw BridgeError.stale }
            let message = (try? decoder.decode(FailureBody.self, from: data))?.error ?? ""
            throw BridgeError.http(code, message)
        }

        return try decoder.decode(T.self, from: data)
    }

    private func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        try await send(request(path, method: "GET"), as: type)
    }

    private func post<T: Decodable>(_ path: String, body: [String: String], as type: T.Type) async throws -> T {
        var req = try request(path, method: "POST")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(req, as: type)
    }

    /// 문자열이 아닌 값(불리언 등)이 섞인 몸통용.
    private func postJSON<T: Decodable>(_ path: String, body: [String: Any], as type: T.Type) async throws -> T {
        var req = try request(path, method: "POST")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(req, as: type)
    }
}
