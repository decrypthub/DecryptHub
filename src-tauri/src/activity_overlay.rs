// Host-owned compositor decoration. Never contacts CDP or changes page content.
pub fn mask(width: usize, height: usize, dpr: f64) -> Vec<u8> {
    let depth = (64.0 * dpr.clamp(0.5, 8.0)).min(width.min(height) as f64 / 3.0).max(1.0);
    let fade = |distance: usize| (1.0 - distance as f64 / depth).clamp(0.0, 1.0).powi(2);
    let mut pixels = vec![0; width * height * 4];
    for y in 0..height { for x in 0..width {
        let a = ((fade(x) + fade(width - 1 - x) + fade(y) + 0.75 * fade(height - 1 - y)) * 64.0).min(100.0) as u8;
        let i = (y * width + x) * 4;
        pixels[i] = a; pixels[i + 1] = (172 * a as u16 / 255) as u8; pixels[i + 2] = (119 * a as u16 / 255) as u8; pixels[i + 3] = a;
    } }
    pixels
}

#[cfg(windows)]
mod imp {
    use super::mask;
    use std::{cell::RefCell, collections::HashMap, time::{Duration, Instant}};
    use windows::{core::w, Win32::{Foundation::{HWND, POINT, SIZE, COLORREF}, Graphics::Gdi::*, UI::WindowsAndMessaging::*}};
    fn hwnd(v: u64) -> HWND { HWND(v as usize as *mut _) }
    struct Image { dc: HDC, bitmap: HBITMAP, previous: HGDIOBJ, width: i32, height: i32 }
    impl Image {
        fn new(width: i32, height: i32, dpr: f64) -> Result<Self, String> { unsafe {
            if width <= 0 || height <= 0 || width as i64 * height as i64 > 16_000_000 { return Err("遮罩尺寸无效".into()); }
            let dc = CreateCompatibleDC(None); if dc.0.is_null() { return Err("创建遮罩DC失败".into()); }
            let info = BITMAPINFO { bmiHeader: BITMAPINFOHEADER { biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32, biWidth: width, biHeight: -height, biPlanes: 1, biBitCount: 32, biCompression: BI_RGB.0, ..Default::default() }, ..Default::default() };
            let mut bits = std::ptr::null_mut();
            let bitmap = match CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) { Ok(v) => v, Err(e) => { let _ = DeleteDC(dc); return Err(e.to_string()); } };
            let previous = SelectObject(dc, HGDIOBJ(bitmap.0));
            let pixels = mask(width as usize, height as usize, dpr);
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len());
            Ok(Self { dc, bitmap, previous, width, height })
        } }
    }
    impl Drop for Image { fn drop(&mut self) { unsafe { SelectObject(self.dc, self.previous); let _ = DeleteObject(HGDIOBJ(self.bitmap.0)); let _ = DeleteDC(self.dc); } } }
    struct Overlay { window: HWND, image: Image, dpr: f64, visible: bool, active: bool, until: Instant, tick: Instant, opacity: f32, alpha: u8, dirty: bool, error: Option<String> }
    impl Drop for Overlay { fn drop(&mut self) { unsafe { let _ = DestroyWindow(self.window); } } }
    impl Overlay {
        fn new(host: u64, width: i32, height: i32, dpr: f64) -> Result<Self, String> { unsafe {
            let image = Image::new(width, height, dpr)?;
            let window = CreateWindowExW(WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE, w!("STATIC"), w!("DecryptHub-ActivityOverlay"), WS_CHILD, 0, 0, width, height, Some(hwnd(host)), None, None, None).map_err(|e| e.to_string())?;
            Ok(Self { window, image, dpr, visible: true, active: true, until: Instant::now(), tick: Instant::now(), opacity: 0.0, alpha: 0, dirty: true, error: None })
        } }
        fn paint(&mut self) -> Result<(), String> { unsafe {
            let now = Instant::now(); let step = now.duration_since(self.tick).as_secs_f32() / 0.3; self.tick = now;
            let target = self.visible && (self.active || now < self.until);
            self.opacity = if target { (self.opacity + step).min(1.0) } else { (self.opacity - step).max(0.0) };
            let alpha = (self.opacity * 255.0) as u8;
            if !self.visible || alpha == 0 { let _ = ShowWindow(self.window, SW_HIDE); return Ok(()); }
            if self.dirty || self.alpha != alpha {
                let blend = BLENDFUNCTION { BlendOp: AC_SRC_OVER as u8, BlendFlags: 0, SourceConstantAlpha: alpha, AlphaFormat: AC_SRC_ALPHA as u8 };
                UpdateLayeredWindow(self.window, None, None, Some(&SIZE { cx: self.image.width, cy: self.image.height }), Some(self.image.dc), Some(&POINT::default()), COLORREF(0), Some(&blend), ULW_ALPHA).map_err(|e| e.to_string())?;
                self.alpha = alpha; self.dirty = false;
            }
            let _ = SetWindowPos(self.window, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            let _ = ShowWindow(self.window, SW_SHOWNA); Ok(())
        } }
    }
    thread_local! { static OVERLAYS: RefCell<HashMap<u64, Overlay>> = RefCell::new(HashMap::new()); }
    pub fn sync(host: u64, width: i32, height: i32, dpr: f64, visible: bool, active: bool) -> Result<(), String> {
        OVERLAYS.with(|items| {
            let mut items = items.borrow_mut();
            if !items.contains_key(&host) { if !visible || !active { return Ok(()); } items.insert(host, Overlay::new(host, width, height, dpr)?); }
            let overlay = items.get_mut(&host).unwrap();
            if let Some(error) = &overlay.error { return Err(error.clone()); }
            if !visible { overlay.visible = false; overlay.active = false; overlay.opacity = 0.0; overlay.until = Instant::now(); unsafe { let _ = ShowWindow(overlay.window, SW_HIDE); } return Ok(()); }
            if overlay.image.width != width || overlay.image.height != height || overlay.dpr != dpr { overlay.image = Image::new(width, height, dpr)?; overlay.dpr = dpr; overlay.dirty = true; }
            overlay.visible = visible; overlay.active = active;
            if active { overlay.until = Instant::now() + Duration::from_millis(400); }
            if !visible { overlay.opacity = 0.0; overlay.until = Instant::now(); }
            unsafe { SetWindowPos(overlay.window, Some(HWND_TOP), 0, 0, width, height, SWP_NOACTIVATE).map_err(|e| e.to_string())?; }
            overlay.paint()
        })
    }
    pub fn tick() { OVERLAYS.with(|items| { for overlay in items.borrow_mut().values_mut() { if overlay.error.is_none() { if let Err(e) = overlay.paint() { overlay.error = Some(e); unsafe { let _ = ShowWindow(overlay.window, SW_HIDE); } } } } }); }
    pub fn release(host: u64) { OVERLAYS.with(|items| { items.borrow_mut().remove(&host); }); }
}
#[cfg(windows)] pub use imp::{sync, tick, release};
#[cfg(not(windows))] pub fn sync(_: u64, _: i32, _: i32, _: f64, visible: bool, active: bool) -> Result<(), String> { if visible && active { Err("原生遮罩暂不支持此平台".into()) } else { Ok(()) } }
#[cfg(not(windows))] pub fn tick() {}
#[cfg(not(windows))] pub fn release(_: u64) {}

#[cfg(test)] mod tests {
    #[test] fn veil_is_transparent_at_center_and_fades_inwards_with_premultiplied_alpha() {
        let pixels = super::mask(400, 400, 1.0);
        let alpha = |x: usize, y: usize| pixels[(y * 400 + x) * 4 + 3];
        assert_eq!(alpha(200, 200), 0); assert!(alpha(0, 200) > alpha(12, 200)); assert!(alpha(12, 200) > alpha(32, 200)); assert_eq!(alpha(80, 200), 0);
        assert!(pixels.chunks(4).all(|p| p[..3].iter().all(|c| *c <= p[3])));
    }
}
