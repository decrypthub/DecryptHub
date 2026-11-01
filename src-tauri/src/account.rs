//! Community identity belongs to the native host, never the renderer or Agent.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{blocking::Client, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{IpAddr, TcpListener, TcpStream, ToSocketAddrs},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::State;

const COMMUNITY: &str = "https://decrypthub.cn";
const VAULT_USER: &str = "community-account";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    id: String,
    handle: String,
    nickname: String,
    avatar_url: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Credential {
    origin: String,
    token: String,
    expires_at: u64,
    profile: Profile,
}

trait Vault: Send + Sync {
    fn load(&self) -> Result<Option<Credential>, String>;
    fn save(&self, credential: &Credential) -> Result<(), String>;
    fn clear(&self) -> Result<(), String>;
}
struct SystemVault;
fn vault_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(super::KEYRING_SERVICE, VAULT_USER).map_err(|_| "无法访问系统凭据库".into())
}
impl Vault for SystemVault {
    fn load(&self) -> Result<Option<Credential>, String> {
        match vault_entry()?.get_password() {
            Ok(raw) => serde_json::from_str(&raw)
                .map(Some)
                .map_err(|_| "账号凭据格式无效，请退出后重新登录".into()),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("无法读取账号凭据，请检查系统凭据库授权".into()),
        }
    }
    fn save(&self, c: &Credential) -> Result<(), String> {
        let raw = serde_json::to_string(c).map_err(|_| "无法保存账号凭据")?;
        vault_entry()?
            .set_password(&raw)
            .map_err(|_| "账号凭据保存失败，请检查系统凭据库授权".into())
    }
    fn clear(&self) -> Result<(), String> {
        match vault_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("账号凭据删除失败，请检查系统凭据库授权".into()),
        }
    }
}

struct Pending {
    cancel: Arc<AtomicBool>,
    url: String,
}
struct Inner {
    initialized: bool,
    revision: u64,
    phase: &'static str,
    error: Option<String>,
    credential: Option<Credential>,
    pending: Option<Pending>,
}
impl Default for Inner {
    fn default() -> Self {
        Self {
            initialized: false,
            revision: 0,
            phase: "signed-out",
            error: None,
            credential: None,
            pending: None,
        }
    }
}

#[derive(Clone)]
pub struct AccountManager {
    inner: Arc<Mutex<Inner>>,
    origin: Result<String, String>,
    vault: Arc<dyn Vault>,
}
impl Default for AccountManager {
    fn default() -> Self {
        let mut origin = Ok(COMMUNITY.to_string());
        #[cfg(debug_assertions)]
        if let Ok(value) = std::env::var("DECRYPTHUB_COMMUNITY_URL") {
            origin = development_origin(&value);
        }
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            origin,
            vault: Arc::new(SystemVault),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    available: bool,
    phase: String,
    profile: Option<Profile>,
    expires_at: Option<u64>,
    error: Option<String>,
    origin: String,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn random_secret() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "无法生成安全登录请求")?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
fn pkce(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
fn development_origin(raw: &str) -> Result<String, String> {
    if raw == COMMUNITY {
        return Ok(raw.into());
    }
    let u = Url::parse(raw).map_err(|_| "社区开发地址无效")?;
    if u.scheme() != "http"
        || u.host_str() != Some("127.0.0.1")
        || u.port().is_none_or(|p| p < 1024)
        || u.path() != "/"
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
    {
        return Err("社区开发地址仅支持本机 127.0.0.1 HTTP 来源".into());
    }
    Ok(u.origin().ascii_serialization())
}

enum RequestError {
    Unauthorized,
    Other(String),
}
fn client() -> Result<Client, RequestError> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|_| RequestError::Other("无法初始化账号连接".into()))
}
fn request(
    origin: &str,
    route: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> Result<Value, RequestError> {
    let client = client()?;
    let mut req = if let Some(data) = body {
        client.post(format!("{origin}{route}")).json(&data)
    } else {
        client.get(format!("{origin}{route}"))
    };
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let response = req
        .send()
        .map_err(|_| RequestError::Other("无法连接社区，请检查网络后重试".into()))?;
    let status = response.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return Err(RequestError::Unauthorized);
    }
    if !status.is_success() {
        return Err(RequestError::Other(
            if status.as_u16() == 404 {
                "社区尚未提供桌面登录接口，请先部署社区更新"
            } else {
                "社区服务暂不可用，请稍后重试"
            }
            .into(),
        ));
    }
    let mut bytes = Vec::new();
    response
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| RequestError::Other("账号响应读取失败".into()))?;
    if bytes.len() > 65536 {
        return Err(RequestError::Other("账号响应过大".into()));
    }
    let data: Value = serde_json::from_slice(&bytes)
        .map_err(|_| RequestError::Other("社区登录响应无效".into()))?;
    if data.get("code").and_then(Value::as_i64) != Some(0) {
        return Err(RequestError::Other("社区登录请求未成功".into()));
    }
    Ok(data["data"].clone())
}
fn error_text(e: RequestError) -> String {
    match e {
        RequestError::Unauthorized => "登录已失效，请重新登录".into(),
        RequestError::Other(s) => s,
    }
}
fn profile(origin: &str, token: &str) -> Result<Profile, RequestError> {
    let value = request(origin, "/auth/desktop/me", Some(token), None)?;
    let p: Profile = serde_json::from_value(value)
        .map_err(|_| RequestError::Other("社区账号资料无效".into()))?;
    if p.id.is_empty() || p.id.len() > 191 || p.handle.len() > 191 || p.nickname.len() > 1000 {
        return Err(RequestError::Other("社区账号资料无效".into()));
    }
    Ok(p)
}
fn revoke(c: &Credential) {
    let _ = request(
        &c.origin,
        "/auth/desktop/logout",
        Some(&c.token),
        Some(json!({})),
    );
}

// Account avatars use a bounded, credential-free native fetch. Do not broaden
// the workbench CSP to allow arbitrary remote images from chat content.
fn public_image_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let b = v.octets();
            !v.is_private()
                && !v.is_loopback()
                && !v.is_link_local()
                && !v.is_broadcast()
                && !v.is_documentation()
                && b[0] != 0
                && b[0] < 224
                && !(b[0] == 100 && (64..=127).contains(&b[1]))
                && !(b[0] == 198 && (18..=19).contains(&b[1]))
                && !(b[0] == 192 && b[1] == 0 && b[2] == 0)
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            s[0] & 0xe000 == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
        }
    }
}

fn fetch_avatar(raw: &str) -> Option<String> {
    let u = Url::parse(raw).ok()?;
    if u.scheme() != "https"
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
        || u.port_or_known_default() != Some(443)
    {
        return None;
    }
    let host = u.host_str()?;
    let addresses = (host, 443).to_socket_addrs().ok()?.collect::<Vec<_>>();
    if addresses.is_empty() || addresses.iter().any(|a| !public_image_ip(a.ip())) {
        return None;
    }
    // Pin the addresses checked above, including across the TLS handshake.
    let client = Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(6))
        .connect_timeout(Duration::from_secs(3))
        .resolve_to_addrs(host, &addresses)
        .build()
        .ok()?;
    let response = client.get(u).send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    let mime = response
        .headers()
        .get("content-type")?
        .to_str()
        .ok()?
        .split(';')
        .next()?
        .trim()
        .to_string();
    if !["image/png", "image/jpeg", "image/webp", "image/gif"].contains(&mime.as_str()) {
        return None;
    }
    let mut bytes = Vec::new();
    response.take(524289).read_to_end(&mut bytes).ok()?;
    if bytes.len() > 524288 {
        return None;
    }
    let valid = match mime.as_str() {
        "image/png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "image/webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    valid.then(|| {
        format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    })
}
fn open_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = Command::new("open");
    #[cfg(windows)]
    let mut cmd = Command::new("explorer.exe");
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let mut cmd = Command::new("xdg-open");
    cmd.arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|_| "无法打开系统浏览器，请检查默认浏览器设置".into())
}

impl AccountManager {
    fn initialize(&self) -> Result<(), String> {
        let origin = self.origin.as_ref().map_err(Clone::clone)?;
        let mut inner = self.inner.lock().map_err(|_| "账号状态不可用")?;
        if inner.initialized {
            return Ok(());
        }
        let saved = self.vault.load()?;
        if let Some(c) = saved {
            if c.origin != *origin || c.expires_at <= now() {
                self.vault.clear()?;
            } else {
                inner.credential = Some(c);
                inner.phase = "signed-in";
            }
        }
        inner.initialized = true;
        Ok(())
    }
    fn snapshot(&self) -> Snapshot {
        let inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        Snapshot {
            available: true,
            phase: inner.phase.into(),
            profile: inner.credential.as_ref().map(|c| c.profile.clone()),
            expires_at: inner.credential.as_ref().map(|c| c.expires_at),
            error: inner.error.clone(),
            origin: self.origin.clone().unwrap_or_default(),
        }
    }
    fn refresh(&self) -> Result<(), String> {
        self.initialize()?;
        let (revision, credential) = {
            let inner = self.inner.lock().map_err(|_| "账号状态不可用")?;
            (inner.revision, inner.credential.clone())
        };
        let Some(mut credential) = credential else {
            return Ok(());
        };
        let result = profile(&credential.origin, &credential.token);
        let mut inner = self.inner.lock().map_err(|_| "账号状态不可用")?;
        if inner.revision != revision {
            return Ok(());
        }
        match result {
            Ok(p) => {
                credential.profile = p;
                self.vault.save(&credential)?;
                inner.credential = Some(credential);
                inner.error = None;
            }
            Err(RequestError::Unauthorized) => {
                self.vault.clear()?;
                inner.credential = None;
                inner.phase = "signed-out";
                inner.error = Some("登录已失效，请重新登录".into());
                inner.revision += 1;
            }
            Err(RequestError::Other(message)) => {
                inner.error = Some(message);
            }
        }
        Ok(())
    }
    fn cancel(&self) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "账号状态不可用")?;
        if let Some(p) = inner.pending.take() {
            p.cancel.store(true, Ordering::SeqCst);
        }
        inner.revision += 1;
        inner.phase = if inner.credential.is_some() {
            "signed-in"
        } else {
            "signed-out"
        };
        inner.error = None;
        Ok(())
    }
    fn logout(&self) -> Result<(), String> {
        // Failure to remove the persistent record must not report a false logout.
        self.initialize()?;
        let credential = {
            let mut inner = self.inner.lock().map_err(|_| "账号状态不可用")?;
            self.vault.clear()?;
            if let Some(p) = inner.pending.take() {
                p.cancel.store(true, Ordering::SeqCst);
            }
            inner.revision += 1;
            inner.phase = "signed-out";
            inner.error = None;
            inner.credential.take()
        };
        if let Some(c) = credential {
            std::thread::spawn(move || revoke(&c));
        }
        Ok(())
    }
    fn begin(&self) -> Result<(), String> {
        self.begin_with(open_browser)
    }
    fn begin_with(&self, opener: impl FnOnce(&str) -> Result<(), String>) -> Result<(), String> {
        self.initialize()?;
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "无法创建本机登录回调")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "无法创建本机登录回调")?;
        let port = listener
            .local_addr()
            .map_err(|_| "无法创建本机登录回调")?
            .port();
        let redirect = format!("http://127.0.0.1:{port}/auth/callback");
        let state = random_secret()?;
        let verifier = random_secret()?;
        let origin = self.origin.as_ref().map_err(Clone::clone)?;
        let mut url =
            Url::parse(&format!("{origin}/desktop/authorize")).map_err(|_| "社区地址无效")?;
        url.query_pairs_mut()
            .append_pair("redirect_uri", &redirect)
            .append_pair("state", &state)
            .append_pair("code_challenge", &pkce(&verifier))
            .append_pair("code_challenge_method", "S256");
        let cancel = Arc::new(AtomicBool::new(false));
        let revision = {
            let mut inner = self.inner.lock().map_err(|_| "账号状态不可用")?;
            if inner.credential.is_some() {
                return Err("请先退出当前账号，再切换账号".into());
            }
            if let Some(p) = inner.pending.take() {
                p.cancel.store(true, Ordering::SeqCst);
            }
            inner.revision += 1;
            inner.phase = "waiting-browser";
            inner.error = None;
            inner.pending = Some(Pending {
                cancel: cancel.clone(),
                url: url.to_string(),
            });
            inner.revision
        };
        if let Err(e) = opener(url.as_str()) {
            self.fail(revision, e.clone());
            return Err(e);
        }
        let manager = self.clone();
        std::thread::spawn(move || {
            manager.listen(listener, port, redirect, state, verifier, revision, cancel)
        });
        Ok(())
    }
    fn fail(&self, revision: u64, error: String) {
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if inner.revision != revision {
            return;
        }
        if let Some(p) = inner.pending.take() {
            p.cancel.store(true, Ordering::SeqCst);
        }
        inner.phase = "signed-out";
        inner.error = Some(error);
    }
    fn commit(&self, revision: u64, c: Credential) -> Result<(), String> {
        let mut inner = self.inner.lock().map_err(|_| "账号状态不可用")?;
        if inner.revision != revision
            || inner
                .pending
                .as_ref()
                .is_none_or(|p| p.cancel.load(Ordering::SeqCst))
        {
            return Err("登录已取消".into());
        }
        self.vault.save(&c)?;
        inner.credential = Some(c);
        inner.pending = None;
        inner.phase = "signed-in";
        inner.error = None;
        Ok(())
    }
    fn listen(
        &self,
        listener: TcpListener,
        port: u16,
        redirect: String,
        state: String,
        verifier: String,
        revision: u64,
        cancel: Arc<AtomicBool>,
    ) {
        let deadline = Instant::now() + Duration::from_secs(300);
        while !cancel.load(Ordering::SeqCst) && Instant::now() < deadline {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
                    let parsed = read_callback(&mut stream, port, &state);
                    match parsed {
                        Ok(Callback::Denied) => {
                            self.fail(revision, "已取消浏览器授权".into());
                            reply(&mut stream, false, "已取消登录，可以关闭此页面。");
                            return;
                        }
                        Ok(Callback::Code(code)) => {
                            {
                                let mut inner =
                                    self.inner.lock().unwrap_or_else(|p| p.into_inner());
                                if inner.revision != revision {
                                    return;
                                }
                                inner.phase = "exchanging";
                            }
                            let result = self.exchange(&code, &verifier, &redirect, revision);
                            match result {
                                Ok(()) => reply(
                                    &mut stream,
                                    true,
                                    "已登录 DecryptHub Agent，可以返回桌面继续使用。",
                                ),
                                Err(error) => {
                                    self.fail(revision, error);
                                    reply(
                                        &mut stream,
                                        false,
                                        "登录未完成，请返回 DecryptHub Agent 查看状态并重试。",
                                    );
                                }
                            }
                            return;
                        }
                        Err(()) => {
                            reply(
                                &mut stream,
                                false,
                                "无效的登录回调，请从 DecryptHub Agent 重新登录。",
                            );
                        }
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(80))
                }
                Err(_) => {
                    self.fail(revision, "登录回调连接失败，请重试".into());
                    return;
                }
            }
        }
        if !cancel.load(Ordering::SeqCst) {
            self.fail(revision, "登录请求已超时，请重新登录".into());
        }
    }
    fn exchange(
        &self,
        code: &str,
        verifier: &str,
        redirect: &str,
        revision: u64,
    ) -> Result<(), String> {
        let origin = self.origin.as_ref().map_err(Clone::clone)?;
        let data = request(
            origin,
            "/auth/desktop/token",
            None,
            Some(json!({"code":code,"code_verifier":verifier,"redirect_uri":redirect})),
        )
        .map_err(error_text)?;
        let token = data["access_token"]
            .as_str()
            .ok_or("社区未返回有效的桌面凭据")?
            .to_string();
        let lifetime = data["expires_in"]
            .as_u64()
            .filter(|v| *v > 0 && *v <= 2592000)
            .ok_or("桌面凭据有效期无效")?;
        if !token.strip_prefix("dhd_").is_some_and(valid_secret)
            || data["scope"] != "account:read"
            || data["token_type"] != "Bearer"
        {
            return Err("桌面凭据无效".into());
        }
        // Capture the issued credential even if profile lookup fails, so it can
        // be revoked rather than left valid after cancellation or vault failure.
        let mut c = Credential {
            origin: origin.clone(),
            token,
            expires_at: now() + lifetime,
            profile: Profile {
                id: String::new(),
                handle: String::new(),
                nickname: String::new(),
                avatar_url: None,
            },
        };
        let result = profile(origin, &c.token).map_err(error_text).and_then(|p| {
            c.profile = p;
            self.commit(revision, c.clone())
        });
        if result.is_err() {
            revoke(&c);
        }
        result
    }
}

enum Callback {
    Code(String),
    Denied,
}
fn valid_secret(raw: &str) -> bool {
    raw.len() == 43
        && raw
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn parse_callback(raw: &str, port: u16, expected: &str) -> Result<Callback, ()> {
    let mut lines = raw.split("\r\n");
    let request = lines
        .next()
        .ok_or(())?
        .split_whitespace()
        .collect::<Vec<_>>();
    if request.len() != 3
        || request[0] != "GET"
        || request[2] != "HTTP/1.1"
        || !request[1].starts_with("/auth/callback?")
    {
        return Err(());
    }
    let mut hosts = lines
        .filter_map(|l| l.split_once(':'))
        .filter(|(k, _)| k.eq_ignore_ascii_case("host"));
    if hosts.next().map(|(_, v)| v.trim()) != Some(format!("127.0.0.1:{port}").as_str())
        || hosts.next().is_some()
    {
        return Err(());
    }
    let u = Url::parse(&format!("http://127.0.0.1:{port}{}", request[1])).map_err(|_| ())?;
    if u.path() != "/auth/callback" || u.fragment().is_some() {
        return Err(());
    }
    let pairs = u.query_pairs().collect::<Vec<_>>();
    if pairs.len() != 2
        || pairs
            .iter()
            .filter(|(k, v)| k == "state" && v == expected)
            .count()
            != 1
    {
        return Err(());
    }
    if let Some((_, code)) = pairs.iter().find(|(k, _)| k == "code") {
        if valid_secret(code) {
            return Ok(Callback::Code(code.to_string()));
        }
    }
    if pairs
        .iter()
        .any(|(k, v)| k == "error" && v == "access_denied")
    {
        return Ok(Callback::Denied);
    }
    Err(())
}
fn read_callback(stream: &mut TcpStream, port: u16, state: &str) -> Result<Callback, ()> {
    let mut bytes = Vec::new();
    let mut b = [0u8; 1];
    while bytes.len() < 8192 {
        if stream.read(&mut b).map_err(|_| ())? == 0 {
            return Err(());
        }
        bytes.push(b[0]);
        if bytes.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    if !bytes.ends_with(b"\r\n\r\n") {
        return Err(());
    }
    parse_callback(std::str::from_utf8(&bytes).map_err(|_| ())?, port, state)
}
fn reply(stream: &mut TcpStream, success: bool, message: &str) {
    let body=format!("<!doctype html><html lang=zh-CN><meta charset=utf-8><meta name=viewport content='width=device-width, initial-scale=1'><title>DecryptHub Agent</title><body style='font-family:system-ui;background:#171717;color:#eee;display:grid;place-items:center;min-height:90vh;margin:0'><main style='padding:32px;max-width:420px'><h1 style='font-size:24px'>DecryptHub Agent</h1><p style='line-height:1.8;color:#aaa'>{message}</p></main></body></html>");
    let status = if success { "200 OK" } else { "400 Bad Request" };
    let _=write!(stream,"HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'\r\nConnection: close\r\n\r\n{body}",body.len());
}

async fn background<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| "账号操作未完成".to_string())?
}
#[tauri::command]
pub async fn account_status(
    manager: State<'_, AccountManager>,
    refresh: Option<bool>,
) -> Result<Snapshot, String> {
    let m = manager.inner().clone();
    background(move || {
        if refresh.unwrap_or(false) {
            m.refresh()?
        } else {
            m.initialize()?
        }
        Ok(m.snapshot())
    })
    .await
}
#[tauri::command]
pub async fn account_login(manager: State<'_, AccountManager>) -> Result<Snapshot, String> {
    let m = manager.inner().clone();
    background(move || {
        m.begin()?;
        Ok(m.snapshot())
    })
    .await
}
#[tauri::command]
pub async fn account_cancel(manager: State<'_, AccountManager>) -> Result<Snapshot, String> {
    let m = manager.inner().clone();
    m.cancel()?;
    Ok(m.snapshot())
}
#[tauri::command]
pub async fn account_logout(manager: State<'_, AccountManager>) -> Result<Snapshot, String> {
    let m = manager.inner().clone();
    background(move || {
        m.logout()?;
        Ok(m.snapshot())
    })
    .await
}
#[tauri::command]
pub async fn account_reopen_login(manager: State<'_, AccountManager>) -> Result<(), String> {
    let url = manager
        .inner
        .lock()
        .map_err(|_| "账号状态不可用")?
        .pending
        .as_ref()
        .map(|p| p.url.clone())
        .ok_or("没有正在等待的登录请求")?;
    background(move || open_browser(&url)).await
}
#[tauri::command]
pub async fn account_open_page(
    manager: State<'_, AccountManager>,
    page: String,
) -> Result<(), String> {
    let path = match page.as_str() {
        "profile" => "/settings/profile",
        "security" => "/settings/security",
        "home" => "/",
        _ => return Err("无效的社区页面".into()),
    };
    let origin = manager.origin.as_ref().map_err(Clone::clone)?;
    let url = format!("{origin}{path}");
    background(move || open_browser(&url)).await
}

#[tauri::command]
pub async fn account_avatar(manager: State<'_, AccountManager>) -> Result<Option<String>, String> {
    let m = manager.inner().clone();
    background(move || {
        let (revision, id, url) = {
            let i = m.inner.lock().map_err(|_| "账号状态不可用")?;
            let Some(c) = i.credential.as_ref() else {
                return Ok(None);
            };
            (
                i.revision,
                c.profile.id.clone(),
                c.profile.avatar_url.clone(),
            )
        };
        let Some(url) = url else { return Ok(None) };
        let data = fetch_avatar(&url);
        let i = m.inner.lock().map_err(|_| "账号状态不可用")?;
        if i.revision != revision
            || !i
                .credential
                .as_ref()
                .is_some_and(|c| c.profile.id == id && c.profile.avatar_url.as_ref() == Some(&url))
        {
            return Ok(None);
        }
        Ok(data)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn avatar_rejects_private_special_and_loopback_addresses() {
        for raw in [
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "192.168.0.1",
            "100.64.0.1",
            "198.18.0.1",
            "0.1.2.3",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:127.0.0.1",
            "2001:db8::1",
        ] {
            assert!(!public_image_ip(raw.parse().unwrap()), "{raw}");
        }
        for raw in ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"] {
            assert!(public_image_ip(raw.parse().unwrap()));
        }
        for raw in [
            "http://127.0.0.1/avatar",
            "file:///etc/passwd",
            "https://user@public.test/a",
            "https://public.test:8080/a",
            "data:image/svg+xml,x",
        ] {
            assert!(fetch_avatar(raw).is_none());
        }
    }
    #[test]
    fn browser_callback_exchanges_pkce_then_persists_profile() {
        let server = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", server.local_addr().unwrap());
        let challenge = Arc::new(Mutex::new(String::new()));
        let expected = challenge.clone();
        let token = format!("dhd_{}", "a".repeat(43));
        let issued = token.clone();
        let worker = std::thread::spawn(move || {
            for step in 0..2 {
                let (mut stream, _) = server.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut head = Vec::new();
                let mut byte = [0u8; 1];
                while !head.ends_with(b"\r\n\r\n") {
                    stream.read_exact(&mut byte).unwrap();
                    head.push(byte[0]);
                    assert!(head.len() < 8192);
                }
                let text = String::from_utf8(head).unwrap();
                let length = text
                    .lines()
                    .find_map(|l| {
                        l.split_once(':')
                            .filter(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                            .map(|(_, v)| v.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                let mut body = vec![0; length];
                stream.read_exact(&mut body).unwrap();
                let data = if step == 0 {
                    assert!(text.starts_with("POST /auth/desktop/token "));
                    let request: Value = serde_json::from_slice(&body).unwrap();
                    assert_eq!(
                        pkce(request["code_verifier"].as_str().unwrap()),
                        *expected.lock().unwrap()
                    );
                    assert!(request["redirect_uri"]
                        .as_str()
                        .unwrap()
                        .starts_with("http://127.0.0.1:"));
                    json!({"access_token":issued,"expires_in":3600,"scope":"account:read","token_type":"Bearer"})
                } else {
                    assert!(text.starts_with("GET /auth/desktop/me "));
                    assert!(text
                        .to_lowercase()
                        .contains(&format!("authorization: bearer {issued}")));
                    json!({"id":"u1","handle":"alice","nickname":"Alice","avatarUrl":null})
                };
                let payload = json!({"code":0,"data":data,"msg":"ok"}).to_string();
                write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",payload.len(),payload).unwrap();
            }
        });
        let (mut manager, vault) = fixture();
        manager.origin = Ok(origin.clone());
        let captured = Arc::new(Mutex::new(String::new()));
        let capture = captured.clone();
        manager
            .begin_with(move |url| {
                *capture.lock().unwrap() = url.to_string();
                Ok(())
            })
            .unwrap();
        let page = Url::parse(&captured.lock().unwrap()).unwrap();
        let query = page
            .query_pairs()
            .into_owned()
            .collect::<std::collections::HashMap<_, _>>();
        *challenge.lock().unwrap() = query["code_challenge"].clone();
        assert_eq!(manager.snapshot().phase, "waiting-browser");
        let callback = format!(
            "{}?code={}&state={}",
            query["redirect_uri"],
            "c".repeat(43),
            query["state"]
        );
        let response = Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
            .unwrap()
            .get(callback)
            .send()
            .unwrap();
        assert_eq!(response.status().as_u16(), 200);
        assert_eq!(manager.snapshot().phase, "signed-in");
        assert_eq!(vault.load().unwrap().unwrap().token, token);
        let restored = AccountManager {
            inner: Arc::new(Mutex::new(Inner::default())),
            origin: Ok(origin),
            vault,
        };
        restored.initialize().unwrap();
        assert_eq!(restored.snapshot().profile.unwrap().handle, "alice");
        worker.join().unwrap();
    }
    #[derive(Default)]
    struct MemoryVault {
        record: Mutex<Option<Credential>>,
        fail: AtomicBool,
    }
    impl Vault for MemoryVault {
        fn load(&self) -> Result<Option<Credential>, String> {
            Ok(self.record.lock().unwrap().clone())
        }
        fn save(&self, c: &Credential) -> Result<(), String> {
            if self.fail.load(Ordering::SeqCst) {
                return Err("storage failed".into());
            }
            *self.record.lock().unwrap() = Some(c.clone());
            Ok(())
        }
        fn clear(&self) -> Result<(), String> {
            if self.fail.load(Ordering::SeqCst) {
                return Err("storage failed".into());
            }
            *self.record.lock().unwrap() = None;
            Ok(())
        }
    }
    fn fixture() -> (AccountManager, Arc<MemoryVault>) {
        let v = Arc::new(MemoryVault::default());
        (
            AccountManager {
                inner: Arc::new(Mutex::new(Inner::default())),
                origin: Ok(COMMUNITY.into()),
                vault: v.clone(),
            },
            v,
        )
    }
    fn credential() -> Credential {
        Credential {
            origin: COMMUNITY.into(),
            token: format!("dhd_{}", "a".repeat(43)),
            expires_at: now() + 300,
            profile: Profile {
                id: "u1".into(),
                handle: "alice".into(),
                nickname: "Alice".into(),
                avatar_url: None,
            },
        }
    }
    fn admit(m: &AccountManager) -> u64 {
        let mut i = m.inner.lock().unwrap();
        i.initialized = true;
        i.revision += 1;
        i.pending = Some(Pending {
            cancel: Arc::new(AtomicBool::new(false)),
            url: String::new(),
        });
        i.phase = "exchanging";
        i.revision
    }
    #[test]
    fn pkce_rfc7636_vector() {
        assert_eq!(
            pkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
    #[test]
    fn callback_binds_state_host_and_route() {
        let state = "s".repeat(43);
        let code = "c".repeat(43);
        let raw=format!("GET /auth/callback?code={code}&state={state} HTTP/1.1\r\nHost: 127.0.0.1:42000\r\n\r\n");
        assert!(matches!(
            parse_callback(&raw, 42000, &state),
            Ok(Callback::Code(_))
        ));
        for bad in [
            raw.replace(&state, "wrong"),
            raw.replace("Host: 127.0.0.1:42000", "Host: evil.test"),
            raw.replace("GET ", "POST "),
            raw.replace("/auth/callback?", "/other?"),
            raw.replace(" HTTP/1.1", &format!("&code={code} HTTP/1.1")),
        ] {
            assert!(parse_callback(&bad, 42000, &state).is_err());
        }
    }
    #[test]
    fn cancel_and_new_attempt_reject_late_commit() {
        let (m, v) = fixture();
        let old = admit(&m);
        m.cancel().unwrap();
        let next = admit(&m);
        assert!(m.commit(old, credential()).is_err());
        assert!(v.load().unwrap().is_none());
        m.commit(next, credential()).unwrap();
        assert_eq!(m.snapshot().phase, "signed-in");
    }
    #[test]
    fn vault_failure_never_announces_signed_in() {
        let (m, v) = fixture();
        let rev = admit(&m);
        v.fail.store(true, Ordering::SeqCst);
        assert!(m.commit(rev, credential()).is_err());
        assert!(m.snapshot().profile.is_none());
        assert!(v.load().unwrap().is_none());
    }
    #[test]
    fn failed_credential_removal_preserves_visible_identity() {
        let (m, v) = fixture();
        let rev = admit(&m);
        m.commit(rev, credential()).unwrap();
        v.fail.store(true, Ordering::SeqCst);
        assert!(m.logout().is_err());
        assert_eq!(m.snapshot().phase, "signed-in");
        assert!(v.load().unwrap().is_some());
    }
    #[test]
    fn expired_and_other_origin_records_do_not_restore() {
        for other in [false, true] {
            let (m, v) = fixture();
            let mut c = credential();
            if other {
                c.origin = "http://127.0.0.1:42000".into()
            } else {
                c.expires_at = 1
            }
            v.save(&c).unwrap();
            m.initialize().unwrap();
            assert_eq!(m.snapshot().phase, "signed-out");
            assert!(v.load().unwrap().is_none());
        }
    }
    #[test]
    fn snapshot_never_contains_credentials() {
        let (m, _) = fixture();
        let rev = admit(&m);
        let c = credential();
        m.commit(rev, c.clone()).unwrap();
        let raw = serde_json::to_string(&m.snapshot()).unwrap();
        assert!(!raw.contains(&c.token));
        assert!(!raw.contains("code_verifier"));
    }
    #[test]
    fn development_endpoint_is_loopback_only() {
        assert_eq!(
            development_origin("http://127.0.0.1:39217").unwrap(),
            "http://127.0.0.1:39217"
        );
        for raw in [
            "https://evil.test",
            "http://localhost:39217",
            "http://127.0.0.1:39217/path",
            "http://u@127.0.0.1:39217",
            "http://127.0.0.1:39217?x=1",
        ] {
            assert!(development_origin(raw).is_err());
        }
    }
}
