// LLM 入口（薄门面）：provider 适配器在 ./providers/，这里只保留连接测试与错误话术。
// 老代码直接 import { chat } from './llm.mjs'，签名与返回形状保持不变。
import { chat } from './providers/index.mjs';

export { chat };

// 连接测试：轻量请求，返回友好中文结果
export async function testConnection(settings) {
  const p = settings.provider;
  try {
    if (p === 'anthropic') {
      const c = settings.anthropic;
      if (!c.apiKey) return { ok: false, message: '请先填写 Claude API Key。' };
      const r = await fetch(c.baseUrl.replace(/\/$/, '') + '/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: c.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      });
      if (r.ok) return { ok: true, message: `连接成功，模型 ${c.model} 可用。` };
      const t = await r.text();
      return { ok: false, message: friendlyHttp(r.status, t) };
    }
    const c = settings.openai;
    if (!c.apiKey) return { ok: false, message: '请先填写 API Key。' };
    const r = await fetch(c.baseUrl.replace(/\/$/, '') + '/models', { headers: { Authorization: 'Bearer ' + c.apiKey } });
    if (r.ok) { const j = await r.json().catch(() => ({})); const n = (j.data || []).length; return { ok: true, message: `连接成功${n ? `，检测到 ${n} 个模型` : ''}。` }; }
    // 某些兼容端点不支持 /models，退化为一次极小对话
    const r2 = await fetch(c.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey },
      body: JSON.stringify({ model: c.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (r2.ok) return { ok: true, message: `连接成功，模型 ${c.model} 可用。` };
    const t = await r2.text();
    return { ok: false, message: friendlyHttp(r2.status, t) };
  } catch (e) {
    return { ok: false, message: '网络错误：' + friendlyNet(e) };
  }
}
function friendlyHttp(status, body) {
  const b = (body || '').slice(0, 160);
  if (status === 401 || status === 403) return 'API Key 无效或无权限（401/403）。请检查密钥是否正确。';
  if (status === 404) return 'Base URL 或模型路径不存在（404）。请检查 Base URL 是否填写完整（通常以 /v1 结尾）。';
  if (status === 429) return '请求过于频繁或额度不足（429）。请稍后重试或检查账户额度。';
  if (status >= 500) return `服务端错误（${status}）。可能是服务商暂时不可用。`;
  return `请求失败（${status}）：${b}`;
}
function friendlyNet(e) {
  const m = String(e && e.message || e);
  if (/ENOTFOUND|getaddrinfo/.test(m)) return '无法解析域名，请检查 Base URL 和网络连接。';
  if (/ECONNREFUSED/.test(m)) return '连接被拒绝，请检查地址/端口或本地服务是否启动。';
  if (/certificate|TLS|SSL/i.test(m)) return '证书/TLS 错误，请检查地址是否为 https 且证书有效。';
  if (/timeout|ETIMEDOUT/i.test(m)) return '连接超时，请检查网络或代理设置。';
  return m;
}
