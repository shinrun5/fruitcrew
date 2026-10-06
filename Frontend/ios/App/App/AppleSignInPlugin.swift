import AuthenticationServices
import Capacitor

/// Native Sign in with Apple for the iPhone app (the website uses Apple's JS
/// instead) — see Frontend/src/lib/appleSignIn.ts. Returns Apple's identity
/// token and one-time authorization code; the server verifies the first and
/// trades the second for the refresh token it revokes if the account is
/// deleted. The name/email only come the very first time someone authorizes.
@objc(AppleSignInPlugin)
public class AppleSignInPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate,
    ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "AppleSignInPlugin"
    public let jsName = "AppleSignIn"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?

    /// { nonce: SHA-256 hex of a one-time random string the app keeps }
    @objc func authorize(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.fullName, .email]
            if let nonce = call.getString("nonce") { request.nonce = nonce }
            self.pending = call
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        bridge?.webView?.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = pending else { return }
        pending = nil
        guard let cred = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = cred.identityToken, let idToken = String(data: tokenData, encoding: .utf8) else {
            call.reject("Apple didn't return a sign-in token")
            return
        }
        call.resolve([
            "identityToken": idToken,
            "authorizationCode": cred.authorizationCode.flatMap { String(data: $0, encoding: .utf8) } ?? "",
            "givenName": cred.fullName?.givenName ?? "",
            "familyName": cred.fullName?.familyName ?? "",
            "email": cred.email ?? "",
        ])
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = pending else { return }
        pending = nil
        let canceled = (error as? ASAuthorizationError)?.code == .canceled
        call.reject(canceled ? "canceled" : error.localizedDescription, canceled ? "CANCELED" : nil)
    }
}
