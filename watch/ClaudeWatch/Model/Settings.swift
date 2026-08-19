import Foundation
import Security

/// 브리지 접속 정보.
/// 주소는 UserDefaults 에, 토큰은 키체인에 둡니다 — 토큰은 세션을 만들 수 있는 열쇠라서요.
final class Settings: ObservableObject {
    static let shared = Settings()

    private enum Key {
        static let host = "bridge.host"
        static let keychainAccount = "bridge.token"
    }

    /// "맥이름.tailnet.ts.net" 형태. 스킴을 안 적으면 https 로 붙습니다.
    @Published var host: String {
        didSet { UserDefaults.standard.set(host, forKey: Key.host) }
    }

    @Published var token: String {
        didSet { Keychain.set(token, account: Key.keychainAccount) }
    }

    /// 빌드할 때 Info.plist 에 박아 둔 기본 주소.
    /// 워치에서 주소를 손으로 넣는 건 너무 고통스러워서, 처음부터 채워 둡니다.
    private static var defaultHost: String {
        (Bundle.main.object(forInfoDictionaryKey: "BridgeDefaultHost") as? String) ?? ""
    }

    private init() {
        let saved = UserDefaults.standard.string(forKey: Key.host) ?? ""
        host = saved.isEmpty ? Self.defaultHost : saved
        token = Keychain.get(account: Key.keychainAccount) ?? ""
    }

    var isConfigured: Bool {
        !host.trimmingCharacters(in: .whitespaces).isEmpty
            && !token.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var baseURL: URL? {
        let clean = host.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty else { return nil }
        // Funnel 이 진짜 인증서를 주므로 기본은 https 입니다. 평문으로 떨어지지 않게 합니다.
        let withScheme = clean.contains("://") ? clean : "https://\(clean)"
        return URL(string: withScheme)
    }
}

enum Keychain {
    static func set(_ value: String, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }

        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(insert as CFDictionary, nil)
    }

    static func get(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
