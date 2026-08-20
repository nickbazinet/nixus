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

use crate::commands::auth::{discard_pending_attempt, dispatch_deep_link_url, CallbackChannel};
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

// Everything is inlined because nothing can be fetched: the tab paints while
// the OS browser is still settling, so a webfont or stylesheet request would
// show the user unstyled text. Colors mirror
// `packages/shared/src/styles/tokens.css` and switch on `prefers-color-scheme`,
// since the browser's mode is independent of the app's own theme setting.
//
// `window.close()` is a bonus, never the exit path: browsers only honor a
// script-initiated close while the tab has no navigation history, and the OAuth
// redirect chain always leaves entries behind. So the page reads as finished on
// its own, with no close button — an affordance that silently fails is worse
// than none.
//
// Attributes inside the icon mark are single-quoted deliberately: a
// double-quoted hex fill produces `"#`, which would end this raw string.
const SUCCESS_PAGE: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in complete - Nixus</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #F1F5F9;
    --card: #FFFFFF;
    --ink: #0F172A;
    --ink-dim: #576578;
    --line: #E2E8F0;
    --good: #047857;
    --good-bg: #E6F4EF;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #080D18;
      --card: #172033;
      --ink: #E8EDF5;
      --ink-dim: #94A3B8;
      --line: #2A3547;
      --good: #34D399;
      --good-bg: #0F3328;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }
  /* Elevation is the card fill over the page fill plus one hairline. Never a
     drop shadow — `box-shadow: none` is a rule in this design system. */
  .card {
    width: 100%;
    max-width: 384px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--card);
    text-align: center;
    animation: rise 320ms cubic-bezier(0.22, 0.61, 0.36, 1) both;
  }
  .panel { padding: 32px 28px 28px; }
  .mark { display: block; margin: 0 auto 20px; }
  .check {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    margin: 0 auto 16px;
    border-radius: 5px;
    background: var(--good-bg);
    color: var(--good);
    animation: pop 260ms cubic-bezier(0.34, 1.4, 0.64, 1) 120ms both;
  }
  h1, .lede, .foot { text-wrap: balance; }
  h1 {
    margin: 0;
    font-size: 21px;
    font-weight: 650;
    line-height: 1.25;
    letter-spacing: -0.02em;
  }
  .lede {
    margin: 8px auto 0;
    max-width: 28ch;
    color: var(--ink-dim);
  }
  .foot {
    margin: 0;
    border-top: 1px solid var(--line);
    padding: 14px 20px;
    color: var(--ink-dim);
    font-size: 13px;
    line-height: 1.45;
  }
  /* Both animations mark the moment sign-in landed, and both run on compositor
     properties only. Each keyframe set declares just a `from`, so the resting
     state is the element's normal style — if animation never runs, the page is
     still fully painted. */
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
  @keyframes pop { from { opacity: 0; transform: scale(0.88); } }
  @media (prefers-reduced-motion: reduce) {
    .card, .check { animation: none; }
  }
</style>
</head>
<body>
<main class="card">
  <div class="panel">
    <svg class='mark' width='44' height='44' viewBox='0 0 32 32' fill='none' xmlns='http://www.w3.org/2000/svg' aria-hidden='true'>
      <defs>
        <linearGradient id='nixus-grad' x1='0' y1='0' x2='1' y2='1'>
          <stop offset='0%' stop-color='#818CF8' />
          <stop offset='50%' stop-color='#A78BFA' />
          <stop offset='100%' stop-color='#F472B6' />
        </linearGradient>
      </defs>
      <rect x='3' y='3' width='7' height='26' rx='2' fill='#818CF8' />
      <rect x='22' y='3' width='7' height='26' rx='2' fill='#F472B6' />
      <polygon points='3,29 10,29 29,3 22,3' fill='url(#nixus-grad)' />
    </svg>
    <span class="check" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
    </span>
    <h1>Sign-in complete</h1>
    <p class="lede">You can close this tab and head back to the Nixus app.</p>
  </div>
  <footer class="foot">Nixus served this page from your own machine.</footer>
</main>
<script>
  // Closes the tab outright in the rare case it has no redirect history. It is
  // a silent no-op otherwise, which is why the page above stands on its own.
  window.close();
</script>
</body>
</html>"#;

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
                dispatch_deep_link_url(&app, &url, CallbackChannel::Loopback);
            }
            // No listener means no attempt can ever complete, so the verifier,
            // CSRF state, and intent are discarded here rather than lingering
            // past the 5-minute window. Safe for the superseding case only
            // because `start_login` stores its new attempt *after* this thread
            // has been unblocked and joined.
            Ok(None) => {
                info!("Local sign-in listener timed out or was superseded");
                discard_pending_attempt(&app);
            }
            Err(_) => {
                info!("Local sign-in listener interrupted");
                discard_pending_attempt(&app);
            }
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
