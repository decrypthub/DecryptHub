import crypto from 'node:crypto';
export function folderProof(token, grant) { return crypto.createHmac('sha256', token).update(`${grant.sessionId}\n${grant.path}\n${grant.expiresAt}`).digest('hex'); }
export function consumeFolderGrant(token, grant, sessionId, consumed) {
  if (!grant || grant.sessionId !== sessionId || typeof grant.path !== 'string' || !Number.isFinite(grant.expiresAt) || grant.expiresAt < Date.now() || grant.expiresAt > Date.now() + 6 * 60000) throw new Error('目录选择凭证已失效，请重新选择');
  const expected = Buffer.from(folderProof(token, grant)), actual = Buffer.from(String(grant.signature || ''));
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected) || consumed.has(grant.signature)) throw new Error('无效或已使用的目录选择凭证');
  for (const [key, expiry] of consumed) if (expiry < Date.now()) consumed.delete(key);
  consumed.set(grant.signature, grant.expiresAt); return grant.path;
}
