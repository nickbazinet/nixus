// Loopback HTTP redirect target for the OAuth flow (RFC 8252 §7.3), replacing
// a direct redirect to `nixus://auth/callback`. Two problems with the direct
// deep-link redirect motivated this: the browser tab is left stuck on
// Cognito's own page forever (we cannot inject a "you can close this tab"
// page into Cognito's Managed Login UI), and Windows shows an "Open Nixus?"
// confirmation prompt for the custom scheme that a plain HTTP navigation does
// not trigger. `tauri-plugin-deep-link` stays registered (see `lib.rs`) as a
// fallback path; `is_auth_callback_url` in `auth.rs` still recognizes the
// legacy `nixus://auth/callback` shape.
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use tauri::AppHandle;
use tiny_http::{Header, Response, Server};
use tracing::{info, warn};

use crate::commands::auth::dispatch_deep_link_url;
use crate::error::AppError;

// Fixed rather than OS-assigned: Cognito's app client callback URL allow-list
// requires an exact string match and has no loopback wildcard, so the port
// must be known ahead of time and registered there (see CONTRIBUTING.md).
pub const LOOPBACK_PORT: u16 = 52847;
pub const LOOPBACK_REDIRECT_URI: &str = "http://127.0.0.1:52847/callback";

// Bounds how long an abandoned sign-in attempt keeps the port bound before
// releasing it, so a later attempt is never blocked indefinitely by one the
// user walked away from.
const LISTENER_TIMEOUT: Duration = Duration::from_secs(300);

const SUCCESS_PAGE: &str = r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Nixus</title></head>
<body style="font-family: sans-serif; text-align: center; padding-top: 4rem;">
<p>Sign-in complete. You can now close this tab.</p>
<script>window.close();</script>
</body></html>"#;

/// Managed state holding the one in-flight loopback listener, mirroring
/// `PendingLogin`'s single-attempt model.
#[derive(Default)]
pub struct LoopbackListener(pub Mutex<Option<(Arc<Server>, JoinHandle<()>)>>);

fn callback_url(request_target: &str) -> String {
    format!("http://127.0.0.1:{LOOPBACK_PORT}{request_target}")
}

/// Starts (or restarts) the loopback listener for one sign-in attempt. A
/// second call supersedes the first: the previous listener is interrupted and
/// joined — releasing the port — before the new one binds it.
pub fn start(app: AppHandle, state: &LoopbackListener) -> Result<(), AppError> {
    let mut slot = state.0.lock().map_err(|_| AppError::Auth {
        message: "Sign-in state is unavailable. Please restart nixus and try again.".to_string(),
        recoverable: false,
    })?;

    if let Some((server, handle)) = slot.take() {
        server.unblock();
        let _ = handle.join();
    }

    let server = Server::http(("127.0.0.1", LOOPBACK_PORT)).map_err(|e| {
        warn!("Failed to bind the local sign-in listener: {}", e);
        AppError::Auth {
            message: "Could not start the local sign-in listener. Please try again.".to_string(),
            recoverable: true,
        }
    })?;
    let server = Arc::new(server);
    let listener_thread_server = server.clone();

    let handle = thread::spawn(move || {
        // `Ok(None)` covers both a genuine timeout and a superseding
        // attempt's `unblock()` call — either way, falling through here drops
        // this thread's `Arc<Server>` clone and releases the port.
        match listener_thread_server.recv_timeout(LISTENER_TIMEOUT) {
            Ok(Some(request)) => {
                let url = callback_url(request.url());
                let content_type: Header = "Content-Type: text/html; charset=utf-8"
                    .parse()
                    .expect("static header value is always valid");
                let response = Response::from_string(SUCCESS_PAGE).with_header(content_type);
                if let Err(e) = request.respond(response) {
                    warn!("Failed to respond to the local sign-in callback: {}", e);
                }
                dispatch_deep_link_url(&app, &url, "loopback");
            }
            Ok(None) => info!("Local sign-in listener timed out with no callback"),
            Err(_) => info!("Local sign-in listener interrupted"),
        }
    });

    *slot = Some((server, handle));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_redirect_uri_matches_the_configured_port() {
        assert_eq!(
            LOOPBACK_REDIRECT_URI,
            format!("http://127.0.0.1:{}/callback", LOOPBACK_PORT)
        );
    }

    #[test]
    fn callback_url_combines_the_port_with_the_request_target() {
        assert_eq!(
            callback_url("/callback?code=abc&state=xyz"),
            "http://127.0.0.1:52847/callback?code=abc&state=xyz"
        );
    }
}
