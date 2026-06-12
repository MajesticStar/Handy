// FlowTrade 2C — translator panel (frontstage).
//
// A fixed-size floating window that shows the two-pane translation
// (raw shorthand | plain English) after a quote is recognized. It is modeled
// on the recording overlay: on macOS it is an NSPanel that floats above other
// apps and never steals focus, so it can appear over the chat app while the
// trader keeps typing.
//
// Deliberately fixed-size and never resized at runtime — the recording overlay
// taught us that resizing an NSPanel mid-flight is unreliable. Content wraps
// inside the panel instead.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
use tauri::WebviewUrl;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel};

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(TranslatorPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

const PANEL_LABEL: &str = "translator_panel";
const PANEL_WIDTH: f64 = 560.0;
const PANEL_HEIGHT: f64 = 300.0;
const PANEL_BOTTOM_OFFSET: f64 = 120.0;

/// Bottom-center of the primary monitor, in logical points.
fn panel_position(app_handle: &AppHandle) -> Option<(f64, f64)> {
    let monitor = app_handle.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let mon_x = monitor.position().x as f64 / scale;
    let mon_y = monitor.position().y as f64 / scale;
    let mon_w = monitor.size().width as f64 / scale;
    let mon_h = monitor.size().height as f64 / scale;

    let x = mon_x + (mon_w - PANEL_WIDTH) / 2.0;
    let y = mon_y + mon_h - PANEL_HEIGHT - PANEL_BOTTOM_OFFSET;
    Some((x, y))
}

/// Creates the translator panel and keeps it hidden by default (macOS).
#[cfg(target_os = "macos")]
pub fn create_translator_panel(app_handle: &AppHandle) {
    let (x, y) = panel_position(app_handle).unwrap_or((100.0, 100.0));
    match PanelBuilder::<_, TranslatorPanel>::new(app_handle, PANEL_LABEL)
        .url(WebviewUrl::App("src/translator/index.html".into()))
        .title("FlowTrade Translator")
        .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
        .level(PanelLevel::Floating)
        .size(tauri::Size::Logical(tauri::LogicalSize {
            width: PANEL_WIDTH,
            height: PANEL_HEIGHT,
        }))
        .has_shadow(true)
        .transparent(true)
        .no_activate(true)
        .corner_radius(12.0)
        .with_window(|w| w.decorations(false).transparent(true))
        .collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary(),
        )
        .build()
    {
        Ok(panel) => {
            let _ = panel.hide();
        }
        Err(e) => {
            log::error!("Failed to create translator panel: {}", e);
        }
    }
}

/// Creates the translator panel and keeps it hidden by default (non-macOS).
#[cfg(not(target_os = "macos"))]
pub fn create_translator_panel(app_handle: &AppHandle) {
    let (x, y) = panel_position(app_handle).unwrap_or((100.0, 100.0));
    let mut builder = WebviewWindowBuilder::new(
        app_handle,
        PANEL_LABEL,
        tauri::WebviewUrl::App("src/translator/index.html".into()),
    )
    .title("FlowTrade Translator")
    .position(x, y)
    .resizable(false)
    .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .focused(false)
    .visible(false);

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    if let Err(e) = builder.build() {
        log::error!("Failed to create translator panel: {}", e);
    }
}

/// Mailbox for the R2 clean-paste handshake. The transcription thread
/// registers a request before emitting `flowtrade-transcription`; the panel
/// webview answers through the `submit_flowtrade_translation` command with
/// the clean shorthand (recognized) or None (not a quote). The transcription
/// thread falls back to the raw transcript on timeout.
static PENDING_TRANSLATION: Mutex<Option<Sender<Option<String>>>> =
    Mutex::new(None);

pub fn register_translation_request() -> Receiver<Option<String>> {
    let (tx, rx) = channel();
    *PENDING_TRANSLATION.lock().unwrap() = Some(tx);
    rx
}

pub fn submit_translation(raw: Option<String>) {
    if let Some(tx) = PENDING_TRANSLATION.lock().unwrap().take() {
        let _ = tx.send(raw);
    }
}

/// Shows the translator panel without stealing focus.
pub fn show_translator_panel(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window(PANEL_LABEL) {
        let _ = window.show();
    }
}

/// Hides the translator panel.
pub fn hide_translator_panel(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window(PANEL_LABEL) {
        let _ = window.hide();
    }
}
