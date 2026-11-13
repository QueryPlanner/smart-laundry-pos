fn main() {
    // Tauri's default manifest is linked into the app binary only. The library test
    // executable also imports TaskDialogIndirect, which requires Common Controls v6.
    if std::env::var("TARGET").is_ok_and(|target| target.ends_with("-windows-msvc")) {
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!(
            "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
        );
        let attributes = tauri_build::Attributes::new()
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        tauri_build::try_build(attributes).expect("failed to build Tauri resources");
    } else {
        tauri_build::build();
    }
}
