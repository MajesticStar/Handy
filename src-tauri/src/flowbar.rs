// FlowTrade — FlowBar (frontstage cockpit control).
//
// A small, always-on floating bar the trader can drag anywhere. Modeled on the
// translator panel (panel.rs): on macOS an NSPanel that floats above other apps
// and never steals focus. Fixed-size and never resized (the recording overlay /
// 2B taught us NSPanel resize mid-flight is unreliable) — the collapsed pill and
// the expanded icon row are both drawn inside the same fixed window via CSS.

use tauri::{AppHandle, Manager};

#[cfg(target_os = "macos")]
use tauri::WebviewUrl;

#[cfg(target_os = "macos")]
use tauri_nspanel::{tauri_panel, CollectionBehavior, PanelBuilder, PanelLevel, StyleMask};

#[cfg(not(target_os = "macos"))]
use tauri::WebviewWindowBuilder;

#[cfg(target_os = "macos")]
tauri_panel! {
    panel!(FlowBarPanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    })
}

const FLOWBAR_LABEL: &str = "flowbar";
const FLOWBAR_WIDTH: f64 = 360.0;
const FLOWBAR_HEIGHT: f64 = 64.0;
const FLOWBAR_BOTTOM_OFFSET: f64 = 40.0;

/// Bottom-center of the monitor under the cursor, in logical points.
/// Falls back to the primary monitor if the cursor position is unavailable.
fn flowbar_position(app_handle: &AppHandle) -> Option<(f64, f64)> {
    let monitor = crate::overlay::get_monitor_with_cursor(app_handle)?;
    let scale = monitor.scale_factor();
    let mon_x = monitor.position().x as f64 / scale;
    let mon_y = monitor.position().y as f64 / scale;
    let mon_w = monitor.size().width as f64 / scale;
    let mon_h = monitor.size().height as f64 / scale;
    let x = mon_x + (mon_w - FLOWBAR_WIDTH) / 2.0;
    let y = mon_y + mon_h - FLOWBAR_HEIGHT - FLOWBAR_BOTTOM_OFFSET;
    Some((x, y))
}

/// Creates the FlowBar and shows it (macOS).
#[cfg(target_os = "macos")]
pub fn create_flowbar(app_handle: &AppHandle) {
    let (x, y) = flowbar_position(app_handle).unwrap_or((100.0, 100.0));
    match PanelBuilder::<_, FlowBarPanel>::new(app_handle, FLOWBAR_LABEL)
        .url(WebviewUrl::App("src/flowbar/index.html".into()))
        .title("FlowTrade")
        .position(tauri::Position::Logical(tauri::LogicalPosition { x, y }))
        .level(PanelLevel::Floating)
        .size(tauri::Size::Logical(tauri::LogicalSize {
            width: FLOWBAR_WIDTH,
            height: FLOWBAR_HEIGHT,
        }))
        // No native corner_radius (unlike panel.rs): the pill is shaped by CSS
        // border-radius inside this transparent window.
        .has_shadow(false)
        .transparent(true)
        .no_activate(true)
        // Make the bar truly non-activating. Without the NonactivatingPanel
        // style mask, pressing/dragging it activates the FlowTrade app, which —
        // if the dashboard sits on another Space — yanks the user to that Space.
        // (no_activate above only covers app activation during creation.)
        .style_mask(StyleMask::empty().nonactivating_panel())
        .with_window(|w| w.decorations(false).transparent(true))
        .collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary(),
        )
        .build()
    {
        Ok(panel) => {
            let _ = panel.show();
        }
        Err(e) => {
            log::error!("Failed to create FlowBar: {}", e);
        }
    }
}

/// Creates the FlowBar and shows it (non-macOS).
#[cfg(not(target_os = "macos"))]
pub fn create_flowbar(app_handle: &AppHandle) {
    let (x, y) = flowbar_position(app_handle).unwrap_or((100.0, 100.0));
    let mut builder = WebviewWindowBuilder::new(
        app_handle,
        FLOWBAR_LABEL,
        tauri::WebviewUrl::App("src/flowbar/index.html".into()),
    )
    .title("FlowTrade")
    .position(x, y)
    .resizable(false)
    .inner_size(FLOWBAR_WIDTH, FLOWBAR_HEIGHT)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .transparent(true)
    .focused(false)
    .visible(true);

    if let Some(data_dir) = crate::portable::data_dir() {
        builder = builder.data_directory(data_dir.join("webview"));
    }

    if let Err(e) = builder.build() {
        log::error!("Failed to create FlowBar: {}", e);
    }
}
