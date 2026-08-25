// Loopback HTTP redirect target for the OAuth flow (RFC 8252 §7.3), replacing
// a direct redirect to `nixus://auth/callback`. Two problems with the direct
// deep-link redirect motivated this: the browser tab is left stuck on
// Cognito's own page forever (we cannot inject a "you can close this tab"
// page into Cognito's Managed Login UI), and Windows shows an "Open Nixus?"
// confirmation prompt for the custom scheme that a plain HTTP navigation does
// not trigger. `tauri-plugin-deep-link` stays registered (see `lib.rs`) as a
// fallback path; `is_auth_callback_url` in `auth.rs` still recognizes the
// legacy `nixus://auth/callback` shape.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tiny_http::{Header, Request, Response, Server};
use tracing::{info, warn};

use crate::commands::auth::{discard_pending_attempt, dispatch_deep_link_url, CallbackChannel};
use crate::error::AppError;

// Fixed rather than OS-assigned: Cognito's app client callback URL allow-list
// requires an exact string match and has no loopback wildcard, so the port
// must be known ahead of time and registered there (see CONTRIBUTING.md).
pub const LOOPBACK_PORT: u16 = 52847;
pub const LOOPBACK_REDIRECT_URI: &str = "http://127.0.0.1:52847/callback";

// Bounds how long an abandoned sign-in attempt waits for its callback, so a
// user who walked away cannot keep an attempt armed indefinitely.
const LISTENER_TIMEOUT: Duration = Duration::from_secs(300);

// Everything in this page is inlined because nothing can be fetched: the tab
// paints while the OS browser is still settling, so a webfont or stylesheet
// request would show the user unstyled text. Colors mirror
// `packages/shared/src/styles/tokens.css` and switch on `prefers-color-scheme`,
// since the browser's mode is independent of the app's own theme setting.
//
// Its `window.close()` is a bonus, never the exit path: browsers only honor a
// script-initiated close while the tab has no navigation history, and the OAuth
// redirect chain always leaves entries behind. So the page reads as finished on
// its own, with no close button — an affordance that silently fails is worse
// than none.
const SUCCESS_PAGE: &str = include_str!("auth_success.html");
/// Managed state holding the process-lifetime loopback server and the worker
/// waiting on the one in-flight attempt, mirroring `PendingLogin`'s
/// single-attempt model.
#[derive(Default)]
pub struct LoopbackListener(Mutex<ListenerState>);

#[derive(Default)]
struct ListenerState {
    bound: Option<BoundServer>,
    worker: Option<AttemptWorker>,
}

/// Both fields are `Arc` so the state keeps its copy while an attempt worker
/// takes another. `faulted` is how a worker reports back that `recv_timeout`
/// failed for real — the only condition that makes a bound server useless —
/// without touching the mutex it was spawned from.
#[derive(Clone)]
struct BoundServer {
    server: Arc<Server>,
    faulted: Arc<AtomicBool>,
}

struct AttemptWorker {
    cancelled: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

/// Everything one attempt's worker owns. Its deadline is fixed when the attempt
/// is armed, so no number of intermediate wakes can extend the window.
struct Attempt {
    server: Arc<Server>,
    cancelled: Arc<AtomicBool>,
    faulted: Arc<AtomicBool>,
    deadline: Instant,
}

/// What an `Ok(None)` from `recv_timeout` means to the waiting worker.
/// `tiny_http` collapses three very different situations into that one value: a
/// genuine timeout, this worker being superseded, and a leftover `unblock()`
/// sentinel that a worker which had already exited never consumed.
#[derive(Debug, PartialEq, Eq)]
enum Wake {
    Superseded,
    Expired,
    KeepWaiting,
}

/// Supersession is checked before expiry on purpose: a superseded worker must
/// never discard the attempt that replaced it, even once its own deadline has
/// passed.
fn classify_wake(cancelled: bool, remaining: Duration) -> Wake {
    if cancelled {
        Wake::Superseded
    } else if remaining.is_zero() {
        Wake::Expired
    } else {
        Wake::KeepWaiting
    }
}

/// Reuses the bound server for every attempt. Rebinding is not an option in the
/// normal case: `tiny_http::Server::drop` only *signals* its detached accept
/// thread, so it cannot guarantee the socket is released, and the next attempt
/// loses a race it has no way to observe. A faulted server is the one exception
/// — it can no longer deliver a callback, so the rebind risk is worth taking.
fn ensure_server(state: &mut ListenerState, port: u16) -> Result<BoundServer, AppError> {
    if let Some(bound) = &state.bound {
        if !bound.faulted.load(Ordering::SeqCst) {
            return Ok(bound.clone());
        }
        warn!("Rebinding the local sign-in listener after a listener fault");
        state.bound = None;
    }

    let server = Server::http(("127.0.0.1", port)).map_err(|e| {
        warn!("Failed to bind the local sign-in listener: {}", e);
        AppError::Auth {
            message: "Could not start the local sign-in listener. Please try again.".to_string(),
            recoverable: true,
        }
    })?;
    let bound = BoundServer {
        server: Arc::new(server),
        faulted: Arc::new(AtomicBool::new(false)),
    };
    state.bound = Some(bound.clone());
    Ok(bound)
}

/// Ends the previous attempt's wait while leaving the socket bound. The join is
/// load-bearing for `start_login`: the outgoing worker is provably finished
/// before the caller stores its replacement attempt, so it cannot discard it.
fn stop_worker(state: &mut ListenerState) {
    let Some(worker) = state.worker.take() else {
        return;
    };
    worker.cancelled.store(true, Ordering::SeqCst);

    // A worker is only ever stored alongside the server it waits on, and that
    // server now outlives every worker.
    if let Some(bound) = &state.bound {
        bound.server.unblock();
        let _ = worker.handle.join();
        drain_stale_signal(bound);
    }
}

/// Consumes the `unblock()` sentinel the stopped worker may have left behind:
/// `tiny_http` queues it, and a worker that had already exited never takes it.
/// `wait_for_callback` survives a leftover sentinel on its own — this only keeps
/// the next attempt from burning its first wake on one.
fn drain_stale_signal(bound: &BoundServer) {
    match bound.server.try_recv() {
        // A callback for an attempt that is already over. Dropping the request
        // answers the abandoned tab with a 500 and keeps the queue clean.
        Ok(Some(_)) => info!("Discarded a callback for a finished sign-in attempt"),
        Ok(None) => {}
        Err(e) => {
            warn!("The local sign-in listener reported an error: {}", e);
            bound.faulted.store(true, Ordering::SeqCst);
        }
    }
}

fn callback_url(request_target: &str) -> String {
    format!("http://127.0.0.1:{LOOPBACK_PORT}{request_target}")
}

fn respond_with_success_page(request: Request) -> String {
    let url = callback_url(request.url());
    let response = Response::from_string(SUCCESS_PAGE);
    let response = match Header::from_bytes("Content-Type", "text/html; charset=utf-8") {
        Ok(content_type) => response.with_header(content_type),
        Err(()) => response,
    };
    if let Err(e) = request.respond(response) {
        warn!("Failed to respond to the local sign-in callback: {}", e);
    }
    url
}

fn wait_for_callback(app: &AppHandle, attempt: &Attempt) {
    loop {
        let remaining = attempt.deadline.saturating_duration_since(Instant::now());
        match classify_wake(attempt.cancelled.load(Ordering::SeqCst), remaining) {
            Wake::Superseded => {
                info!("Local sign-in listener superseded by a newer attempt");
                return;
            }
            // No wait left means no attempt can ever complete, so the verifier,
            // CSRF state, and intent are discarded rather than lingering past
            // the window.
            Wake::Expired => {
                info!("Local sign-in listener timed out");
                discard_pending_attempt(app);
                return;
            }
            Wake::KeepWaiting => {}
        }

        match attempt.server.recv_timeout(remaining) {
            Ok(Some(request)) => {
                let url = respond_with_success_page(request);
                dispatch_deep_link_url(app, &url, CallbackChannel::Loopback);
                return;
            }
            // Deliberately re-classified at the top of the next iteration: the
            // same value covers supersession, a stale sentinel, and the real
            // deadline, and only the deadline ends the wait.
            Ok(None) => {}
            Err(e) => {
                warn!("The local sign-in listener failed: {}", e);
                attempt.faulted.store(true, Ordering::SeqCst);
                if !attempt.cancelled.load(Ordering::SeqCst) {
                    discard_pending_attempt(app);
                }
                return;
            }
        }
    }
}

/// Arms the loopback listener for one sign-in attempt. A second call supersedes
/// the first: only the previous attempt's worker is stopped and joined, while the
/// bound socket is kept for the life of the process.
pub fn start(app: AppHandle, state: &LoopbackListener) -> Result<(), AppError> {
    let mut state = state.0.lock().map_err(|_| AppError::Auth {
        message: "Sign-in state is unavailable. Please restart nixus and try again.".to_string(),
        recoverable: false,
    })?;

    // Before `ensure_server`, so a faulted server is unblocked and joined while
    // the state still holds the exact server its worker is parked on.
    stop_worker(&mut state);
    let bound = ensure_server(&mut state, LOOPBACK_PORT)?;

    let cancelled = Arc::new(AtomicBool::new(false));
    let attempt = Attempt {
        server: bound.server,
        cancelled: cancelled.clone(),
        faulted: bound.faulted,
        deadline: Instant::now() + LISTENER_TIMEOUT,
    };
    let handle = thread::spawn(move || wait_for_callback(&app, &attempt));

    state.worker = Some(AttemptWorker { cancelled, handle });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;

    fn bound_port(server: &Server) -> u16 {
        server
            .server_addr()
            .to_ip()
            .expect("the loopback listener always binds an IP socket")
            .port()
    }

    #[test]
    fn successive_acquisitions_reuse_one_bound_server() {
        let mut state = ListenerState::default();

        let first =
            ensure_server(&mut state, 0).expect("the first attempt binds an ephemeral port");
        let port = bound_port(&first.server);

        let second = ensure_server(&mut state, port)
            .expect("a later attempt must reuse the already-bound server");

        assert!(Arc::ptr_eq(&first.server, &second.server));
        assert_eq!(bound_port(&second.server), port);
    }

    #[test]
    fn a_completed_callback_keeps_the_server_reusable_for_the_next_attempt() {
        let mut state = ListenerState::default();
        let first =
            ensure_server(&mut state, 0).expect("the first attempt binds an ephemeral port");
        let port = bound_port(&first.server);
        let client = thread::spawn(move || {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("callback connects");
            stream
                .write_all(
                    b"GET /callback HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
                )
                .expect("callback request is sent");
            let mut response = String::new();
            stream
                .read_to_string(&mut response)
                .expect("callback response is read");
            response
        });

        let request = first
            .server
            .recv_timeout(Duration::from_secs(1))
            .expect("listener stays healthy")
            .expect("callback arrives");
        request
            .respond(Response::from_string("ok"))
            .expect("callback receives a response");
        let response = client.join().expect("callback client exits");
        assert!(response.starts_with("HTTP/1.1 200"));

        let second = ensure_server(&mut state, port)
            .expect("the next attempt reuses the callback server without rebinding");
        assert!(Arc::ptr_eq(&first.server, &second.server));
    }

    #[test]
    fn a_faulted_server_is_replaced_on_the_next_acquisition() {
        let mut state = ListenerState::default();

        let first =
            ensure_server(&mut state, 0).expect("the first attempt binds an ephemeral port");
        first.faulted.store(true, Ordering::SeqCst);

        let second =
            ensure_server(&mut state, 0).expect("a faulted server is rebound on an ephemeral port");

        assert!(!Arc::ptr_eq(&first.server, &second.server));
        assert!(!second.faulted.load(Ordering::SeqCst));
    }

    #[test]
    fn a_cancelled_worker_reads_as_superseded_even_after_its_deadline() {
        assert_eq!(
            classify_wake(true, Duration::from_secs(30)),
            Wake::Superseded
        );
        assert_eq!(classify_wake(true, Duration::ZERO), Wake::Superseded);
    }

    #[test]
    fn a_stale_wake_before_the_deadline_keeps_the_attempt_waiting() {
        assert_eq!(
            classify_wake(false, Duration::from_nanos(1)),
            Wake::KeepWaiting
        );
        assert_eq!(classify_wake(false, LISTENER_TIMEOUT), Wake::KeepWaiting);
    }

    #[test]
    fn an_uncancelled_wake_with_no_time_left_expires_the_attempt() {
        assert_eq!(classify_wake(false, Duration::ZERO), Wake::Expired);
    }

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
