//! Large OAuth records use atomic keyring indirection; no grants go to disk or the renderer.
use sha2::{Digest, Sha256};
const SERVICE: &str = "com.webdecrypthub.app";
#[derive(serde::Deserialize, serde::Serialize)]
struct Parts { decrypthub_keyring_chunks: u8, id: String, count: usize, digest: String }
fn digest(value: &[u8]) -> String { Sha256::digest(value).iter().map(|b| format!("{b:02x}")).collect() }
fn raw_read(user: &str) -> Result<String, String> {
    match keyring::Entry::new(SERVICE, user).map_err(|e| e.to_string())?.get_password() {
        Ok(value) => Ok(value), Err(keyring::Error::NoEntry) => Ok(String::new()), Err(error) => Err(error.to_string()),
    }
}
fn raw_write(user: &str, value: &str) -> Result<(), String> { keyring::Entry::new(SERVICE, user).map_err(|e| e.to_string())?.set_password(value).map_err(|e| e.to_string()) }
fn part_name(user: &str, parts: &Parts, index: usize) -> String { format!("{user}::DH:{}:{index}", parts.id) }
fn parse(value: &str) -> Result<Option<Parts>, String> {
    if !value.starts_with("{\"decrypthub_keyring_chunks\":") { return Ok(None); }
    let parts: Parts = serde_json::from_str(value).map_err(|_| "凭据分片索引损坏".to_string())?;
    if parts.decrypthub_keyring_chunks != 1 || parts.id.len() != 32 || !parts.id.bytes().all(|b| b.is_ascii_hexdigit()) || parts.count == 0 || parts.count > 256 || parts.digest.len() != 64 { return Err("凭据分片索引无效".into()); }
    Ok(Some(parts))
}
fn cleanup(user: &str, parts: &Parts) { for index in 0..parts.count { if let Ok(entry) = keyring::Entry::new(SERVICE, &part_name(user, parts, index)) { let _ = entry.delete_credential(); } } }
pub fn read(user: &str) -> Result<String, String> {
    let value = raw_read(user)?;
    let Some(parts) = parse(&value)? else { return Ok(value); };
    let mut bytes = Vec::new();
    for index in 0..parts.count {
        let chunk = raw_read(&part_name(user, &parts, index))?;
        if chunk.is_empty() || chunk.len() > 1200 || chunk.len() % 2 != 0 || !chunk.bytes().all(|b| b.is_ascii_hexdigit()) { return Err("凭据分片缺失或损坏".into()); }
        for offset in (0..chunk.len()).step_by(2) { bytes.push(u8::from_str_radix(&chunk[offset..offset+2], 16).map_err(|_| "凭据分片编码无效".to_string())?); }
    }
    if digest(&bytes) != parts.digest { return Err("凭据分片校验失败".into()); }
    String::from_utf8(bytes).map_err(|_| "凭据编码无效".into())
}
pub fn write(user: &str, value: &str) -> Result<(), String> {
    if value.len() > 100_000 { return Err("凭据超过保存上限".into()); }
    let previous = parse(&raw_read(user)?)?;
    if value.encode_utf16().count() <= 1200 { raw_write(user, value)?; }
    else {
        let mut nonce = [0u8; 16]; getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
        let parts = Parts { decrypthub_keyring_chunks: 1, id: nonce.iter().map(|b| format!("{b:02x}")).collect(), count: value.len().div_ceil(600), digest: digest(value.as_bytes()) };
        let result = (|| {
            for (index, chunk) in value.as_bytes().chunks(600).enumerate() { let encoded: String = chunk.iter().map(|b| format!("{b:02x}")).collect(); raw_write(&part_name(user, &parts, index), &encoded)?; }
            raw_write(user, &serde_json::to_string(&parts).map_err(|e| e.to_string())?)
        })();
        if let Err(error) = result { cleanup(user, &parts); return Err(error); }
    }
    if let Some(parts) = previous { cleanup(user, &parts); }
    Ok(())
}
pub fn clear(user: &str) -> Result<(), String> {
    let previous = parse(&raw_read(user)?)?;
    match keyring::Entry::new(SERVICE, user).map_err(|e| e.to_string())?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => {}, Err(error) => return Err(error.to_string()) }
    if let Some(parts) = previous { cleanup(user, &parts); } Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_keyring_large_record_round_trip_preserves_unicode_and_rejects_oversize() {
        let mut nonce = [0u8;16]; getrandom::fill(&mut nonce).unwrap();
        let user = format!("llm-api-key::fixture-{}", digest(&nonce));
        struct Cleanup(String); impl Drop for Cleanup { fn drop(&mut self) { let _ = clear(&self.0); } }
        let _cleanup = Cleanup(user.clone());
        let value = "fixture-认证令牌-".repeat(600);
        write(&user, &value).unwrap(); assert_eq!(read(&user).unwrap(), value);
        assert!(write(&user, &"x".repeat(100_001)).is_err()); assert_eq!(read(&user).unwrap(), value);
        write(&user, "short-fixture").unwrap(); assert_eq!(read(&user).unwrap(), "short-fixture");
        clear(&user).unwrap(); assert_eq!(read(&user).unwrap(), "");
    }
}
