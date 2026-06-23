// FlowTrade — Recents picker panel.
//
// A fixed-size floating window that lists recent canonical quotes and lets the
// trader copy one to the clipboard. Modeled on flowbar.rs: on macOS an
// NSPanel that floats above other apps and never steals focus. Hidden by
// default (like panel.rs); shown/hidden by command. Fixed-size and never
// resized at runtime.

use tauri::{AppHandle, Emitter, Manager};

#[cfg(target_os = "macos")]
use tauri::WebviewUrl;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(RecentsPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

const RECENTS_LABEL: &str = "recents";
const RECENTS_WIDTH: f64 = 320.0;
const RECENTS_HEIGHT: f64 = 260.0;
const RECENTS_BOTTOM_OFFSET: f64 = 120.0;

/// Bottom-center of the primary monitor, in logical points.
fn recents_position(app_handle: &AppHandle) -> Option<(f64, f64)> {
    let monitor = app_handle.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let mon_x = monitor.position().x as f64 / scale;
    let mon_y = monitor.position().y as f64 / scale;
    let mon_w = monitor.size().width as f64 / scale;
    let mon_h = monitor.size().height as f64 / scale;
    let x = mon_x + (mon_w - RECENTS_WIDTH) / 2.0;
    let y = mon_y + mon_h - RECENTS_HEIGHT - RECENTS_BOTTOM_OFFSET;
    Some((x, y))
}

/// Creates the Recents picker panel and keeps it hidden by default (macOS).
#[cfg(target_os = "macos")]
pub fn create_recents_picker(app_handle: &AppHandle) {
    let (x, y) = recents_position(app_handle).unwrap_or((100.0, 100.0));
    match PanelBuilder::<_, RecentsPanel>::new(app_handle, RECENTS_LABEL)
        .url(WebviewUrl::App("src/recents/index.html".into()))
        .title("FlowTrade Recents")
        .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
        .level(PanelLevel::Floating)
        .size(tauri::Size::Logical(tauri::LogicalSize {
            width: RECENTS_WIDTH,
            height: RECENTS_HEIGHT,
        }))
        .has_shadow(true)
        .transparent(true)
        .no_activate(true)
        // Non-activating style mask: without this, clicking the panel activates
        // the FlowTrade app and (if the dashboard is on another Space) yanks the
        // user to that Space. Mirrors flowbar.rs — do not remove.
        .style_mask(StyleMask::empty().nonactivating_panel())
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
            log::error!("Failed to create Recents picker: {}", e);
        }
    }
}

/// Creates the Recents picker panel and keeps it hidden by default (non-macOS).
#[cfg(not(target_os = "macos"))]
pub fn create_recents_picker(app_handle: &AppHandle) {
    let (x, y) = recents_position(app_handle).unwrap_or((100.0, 100.0));
    let mut builder = WebviewWindowBuilder::new(
        app_handle,
        RECENTS_LABEL,
        tauri::WebviewUrl::App("src/recents/index.html".into()),
    )
    .title("FlowTrade Recents")
    .position(x, y)
    .resizable(false)
    .inner_size(RECENTS_WIDTH, RECENTS_HEIGHT)
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
        log::error!("Failed to create Recents picker: {}", e);
    }
}

#[tauri::command]
#[specta::specta]
pub fn show_recents_picker(app: AppHandle) {
    if let Some(win) = app.get_webview_window(RECENTS_LABEL) {
        let _ = win.show();
        // Tell the webview to refresh its list each time it opens.
        let _ = app.emit("recents-refresh", ());
    }
}

#[tauri::command]
#[specta::specta]
pub fn hide_recents_picker(app: AppHandle) {
    if let Some(win) = app.get_webview_window(RECENTS_LABEL) {
        let _ = win.hide();
    }
}
