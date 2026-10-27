// 右侧停靠栏：浏览器 / 请求 / 产出。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Text, Badge, TextField, SegmentedControl, Separator, Spinner, Code, TextArea, Tabs } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, Icon, Markdown, EmptyState } from './kit.jsx';
import { fmtSize, fmtMs, isApi, shortPath, hostOf } from './state.js';
import { parseBody } from '../../sidecar/sig.mjs';
import { native } from './transport.js';
import { WorkspaceFiles } from './files.jsx';
import { handleWindowDrag } from './window-drag.js';
import { BrowserPanel } from './browser-panel.jsx';

const TABS = [['browser', '浏览器', 'globe'], ['evidence', '网络请求', 'network'], ['code', '工作区文件', 'folder']];

export function Dock() {
  const { side, setSide, cur } = useWorkbench();
  const apiCount = cur.requests.filter(isApi).length;
  return <Tabs.Root className="dock-layout" value={side} onValueChange={setSide}>
    <div className="dock-head" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      <Tabs.List className="dock-tabs" size="2" aria-label="分析工具">
        {TABS.map(([k, l, icon]) => <Tabs.Trigger key={k} value={k} className="dock-tab" aria-label={l} title={l}><Flex as="span" align="center" gap="2"><Icon n={icon} /><span className="dock-tab-label">{l}</span>{k === 'evidence' && apiCount > 0 && <Badge size="1" color="gray">{apiCount}</Badge>}</Flex></Tabs.Trigger>)}
      </Tabs.List>
    </div>
    <Tabs.Content className="dock-body" value={side}>
      {side === 'browser' && <BrowserPanel />}
      {side === 'evidence' && <RequestPanel />}
      {side === 'code' && <WorkspaceFiles />}
    </Tabs.Content>
  </Tabs.Root>;
}

// ---------------- 请求 ----------------
const TYPE_FILTERS = [['all', '全部'], ['api', 'XHR'], ['js', 'JS'], ['doc', 'Doc'], ['other', '其他']];
const groupOf = t => (t === 'xhr' || t === 'fetch') ? 'api' : t === 'script' ? 'js' : t === 'document' ? 'doc' : 'other';
const statusClass = s => s === 'pending' ? 'pend' : s === 'failed' || s === 0 ? 'bad' : s >= 500 ? 'bad' : s >= 400 ? 'warn' : s >= 300 ? 'redir' : 'ok';

function RequestPanel() {
  const { cur, inv, toast, addAtt, setInput } = useWorkbench();
  const mode = 'req';
  const [q, setQ] = useState('');
  const [type, setType] = useState('api');
  const [sel, setSel] = useState(null);
  const paused = cur.status.capturePaused !== false;
  const all = cur.requests;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(r => (type === 'all' || groupOf(r.type) === type) && (!needle || r.url.toLowerCase().includes(needle) || (r.sig || []).some(s => s.toLowerCase().includes(needle))));
  }, [all, q, type]);
  const counts = useMemo(() => { const c = { all: all.length, api: 0, js: 0, doc: 0, other: 0 }; for (const r of all) c[groupOf(r.type)]++; return c; }, [all]);

  const attach = (r, intent) => {
    if (!r) return;
    addAtt({ key: 'r:' + r.id + (intent ? ':' + intent : ''), kind: 'request', id: r.id, intent, label: `${r.method} ${shortPath(r.url)}` });
    if (intent === 'analyze-sig') setInput('分析这个请求里的签名参数，定位生成代码。');
    else if (intent === 'reproduce') setInput('在本地复现这个请求，并和浏览器结果对比。');
  };

  async function exportHar(kind) {
    const ids = kind === 'all' ? null : list.map(r => r.id);
    if (!ids?.length) { toast('没有可导出的请求', 'warn'); return; }
    let host = 'capture'; try { host = new URL(cur.url).host.replace(/^www\./, '') || host; } catch {}
    const name = `${host}-${kind}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.har`;
    const path = await native.pickSavePath(name).catch(e => { toast('无法打开保存对话框：' + e, 'err'); return null; });
    if (!path) return;
    try { const r = await inv('har-export', { ids, path: /\.har$/i.test(path) ? path : path + '.har' }); toast(`已导出 ${r.entries} 条 · ${fmtSize(r.bytes)}`, 'ok', 5000); }
    catch (e) { toast('导出失败：' + e.message, 'err'); }
  }

  return <>
    <div className="bar">
      <Text size="2" weight="medium">网络请求 {all.length}</Text>
      <Box flexGrow="1" style={{ minWidth: 80 }}>
        <TextField.Root size="1" value={q} onChange={e => setQ(e.target.value)} placeholder={mode === 'req' ? '过滤 URL / 参数名' : '过滤脚本 URL'}>
          <TextField.Slot><Icon n="search" size={12} /></TextField.Slot>
        </TextField.Root>
      </Box>
      {mode === 'req' && <>
        <ActionIcon icon="stop" aria-pressed={paused} color={paused ? 'amber' : 'gray'} onClick={() => inv('net-pause', { paused: !paused }).catch(e => toast(e.message, 'err'))} title={paused ? '开始记录网络' : '暂停记录网络'} />
        <ActionIcon icon="trash" variant="soft" color="gray" onClick={() => { inv('clear-requests'); setSel(null); }} title="清空列表" />
        <ActionIcon icon="download" variant="soft" color="gray" onClick={() => exportHar('filtered')} title="导出当前筛选为 HAR" />
      </>}
    </div>

    <>
        <div className="bar wrap">
          {TYPE_FILTERS.map(([k, l]) => <Button key={k} size="2" variant={type === k ? 'soft' : 'ghost'} color={type === k ? undefined : 'gray'} onClick={() => setType(k)}>{l} <Text size="1" color="gray">{counts[k]}</Text></Button>)}
          <Box flexGrow="1" />
          <Text size="1" color="gray">{list.length} / {all.length}</Text>
        </div>
        <div className="req-head">
          <span>方法</span><span>状态</span><span>名称</span><span>类型</span><span className="num">大小</span><span className="num">耗时</span>
        </div>
        <div className="req-list">
          {!list.length && <EmptyState icon="network" title={all.length ? '无匹配请求' : '暂无请求'} description={all.length ? '试试其他筛选条件。' : paused ? '抓包已暂停。点击开始记录后，刷新或操作网页。' : '操作网页后，记录会出现在这里。'} />}
          {list.slice(-1200).map(r => <button key={r.id} className={'req-row' + (sel === r.id ? ' on' : '')} onClick={() => setSel(sel === r.id ? null : r.id)} title={r.url}
            onContextMenu={e => { e.preventDefault(); attach(r); }}>
            <span className={'meth ' + r.method}>{r.method}</span>
            <span className={'stat ' + statusClass(r.status)}>{r.status === 'pending' ? '···' : r.status === 'failed' ? 'ERR' : r.status}</span>
            <span className="name">
              <b>{shortPath(r.url)}</b>
              <i>{hostOf(r.url)}{r.sig?.length ? <em title="疑似签名的参数"> · {r.sig.slice(0, 2).join(' ')}</em> : null}</i>
            </span>
            <span className="ty">{r.type}</span>
            <span className="num">{fmtSize(r.size ?? r.encodedSize)}</span>
            <span className="num">{fmtMs(r.duration)}</span>
          </button>)}
        </div>
        {sel && <RequestDetail id={sel} onClose={() => setSel(null)} onSend={attach} />}
      </>
  </>;
}

function RequestDetail({ id, onClose, onSend }) {
  const { cur, inv, toast, addAtt } = useWorkbench();
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('overview');
  const sum = cur.requests.find(r => r.id === id);
  const ver = sum ? `${sum.status}|${sum.bodyState}|${sum.duration}` : '';
  useEffect(() => { let live = true; inv('net-detail', { id }).then(x => live && setD(x)).catch(() => {}); return () => { live = false; }; }, [id, ver]);
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); toast('已复制' + what, 'ok'); } catch (e) { toast('复制失败', 'err'); } };

  if (!d) return <div className="detail"><div className="blank-sm">{sum ? '加载中…' : '该请求已被清除'}</div></div>;
  const isImg = d.body?.encoding && /^image\//.test(d.mime || '');
  const payload = parseBody(d.postData, d.headers?.['content-type'] || '');
  const kv = o => Object.entries(o || {}).filter(([k]) => !k.startsWith(':')).map(([name, value]) => ({ name, value }));

  return <Tabs.Root className="detail" value={tab} onValueChange={setTab}>
    <div className="detail-head">
      <span className={'meth ' + d.method}>{d.method}</span>
      <span className={'stat ' + statusClass(d.status)}>{d.status}</span>
      <Text size="1" className="mono ellipsis" title={d.url} style={{ flex: 1 }}>{d.url}</Text>
      <Button size="2" variant="soft" color="gray" onClick={() => onSend(sum, 'analyze-sig')} title="把请求发给 AI 分析签名"><Icon n="key" size={16} />签名</Button>
      <Button size="2" variant="soft" color="gray" onClick={() => onSend(sum, 'reproduce')} title="让 AI 本地复现"><Icon n="sparkles" size={16} />复现</Button>
      <ActionIcon icon="x" variant="soft" color="gray" onClick={onClose} title="关闭详情" />
    </div>
    <div className="detail-toolbar">
      <Tabs.List className="detail-tabs" size="1" aria-label="请求详情">
        {[['overview', '概览'], ['headers', '请求头'], ['payload', '载荷'], ['response', '响应'], ['timing', '时序']].map(([k, l]) => <Tabs.Trigger value={k} key={k}>{l}</Tabs.Trigger>)}
      </Tabs.List>
      <Flex gap="2"><ActionIcon icon="copy" onClick={() => copy(d.url, ' URL')} title="复制 URL" />
      <ActionIcon icon="terminal" onClick={() => copy(toCurl(d), ' cURL')} title="复制为 cURL" /></Flex>
    </div>
    <Tabs.Content className="detail-body" value={tab}>
      {tab === 'overview' && <>
        {d.sig?.length > 0 && <div className="sigbox">
          <Flex align="center" gap="1" mb="2"><Icon n="key" size={12} /><Text size="1" weight="bold" color="tomato">疑似签名参数 {d.sig.length}</Text></Flex>
          {d.sig.map((s, i) => <Flex key={i} align="center" gap="2" py="1">
            <Badge size="1" variant="soft" color="gray">{({ query: '查询', header: '头', body: '体' })[s.where]}</Badge>
            <Text size="1" weight="bold" className="mono">{s.name}</Text>
            <Code size="1" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'copy' }} onClick={() => copy(s.value, ' ' + s.name)} title="点击复制">{s.value}</Code>
          </Flex>)}
        </div>}
        <KV rows={[
          ['URL', d.url], ['状态', `${d.status} ${d.statusText || ''}`], ['类型', d.type], ['MIME', d.mime || '-'],
          ['大小', `${fmtSize(d.size)}（传输 ${fmtSize(d.encodedSize)}）${d.fromCache ? ' · 缓存' : ''}`],
          ['耗时', fmtMs(d.duration)], ['远端', d.remoteIP || '-'], ['发起者', d.initiator ? `${d.initiator.type}${d.initiator.fn ? ' · ' + d.initiator.fn : ''}` : '-'],
          ['响应体', d.body ? `${d.body.encoding ? 'base64 二进制' : '文本'} · ${fmtSize(d.body.size)}` : (d.bodyState || '-')],
        ]} />
        {d.failure && <Text as="div" size="1" color="red" mt="2">{d.failure}</Text>}
      </>}
      {tab === 'headers' && <>
        <Text as="div" size="1" weight="bold" mb="1">请求头</Text>
        <KV rows={kv(d.headers)} />
        <Text as="div" size="1" weight="bold" mt="4" mb="1">响应头</Text>
        <KV rows={kv(d.respHeaders)} />
      </>}
      {tab === 'payload' && <>
        <Text as="div" size="1" weight="bold" mb="1">查询参数</Text>
        {d.query?.length ? <KV rows={d.query} /> : <Text size="1" color="gray">（无）</Text>}
        <Text as="div" size="1" weight="bold" mt="4" mb="1">请求体 · {({ json: 'JSON', form: '表单', multipart: 'multipart', raw: '原始' })[payload.kind]}</Text>
        {d.postData == null ? <Text size="1" color="gray">（无）</Text>
          : payload.kind === 'json' ? <pre className="raw">{JSON.stringify(payload.json, null, 2)}</pre>
          : <pre className="raw">{d.postData}</pre>}
      </>}
      {tab === 'response' && <>
        {!d.body ? <Text size="1" color="gray">没有响应体（{d.bodyState || '未知'}）</Text>
          : isImg ? <div style={{ textAlign: 'center' }}><img src={`data:${d.mime};base64,${d.body.text}`} style={{ maxWidth: '100%', maxHeight: 420 }} /></div>
          : <pre className="raw">{d.body.encoding ? '(二进制 base64)\n' + d.body.text.slice(0, 20000) : d.body.text}</pre>}
      </>}
      {tab === 'timing' && <Timing d={d} />}
    </Tabs.Content>
  </Tabs.Root>;
}

function KV({ rows }) {
  if (!rows?.length) return <Text size="1" color="gray">（无）</Text>;
  return <div className="kv">{rows.map((r, i) => <div key={i} className="kv-row"><span className="k">{r.name}</span><span className="v">{String(r.value)}</span></div>)}</div>;
}

function Timing({ d }) {
  const t = d.timing;
  if (!t) return <Text size="1" color="gray">没有时序数据</Text>;
  const seg = (a, b) => (a >= 0 && b >= 0 && b >= a ? b - a : null);
  const end = t.endMs ?? t.receiveHeadersEnd;
  const rows = [['排队', 0, t.dnsStart >= 0 ? t.dnsStart : t.sendStart], ['DNS', t.dnsStart, t.dnsEnd], ['连接', t.connectStart, t.connectEnd], ['TLS', t.sslStart, t.sslEnd], ['发送', t.sendStart, t.sendEnd], ['等待', t.sendEnd, t.receiveHeadersEnd], ['下载', t.receiveHeadersEnd, end]]
    .map(([l, a, b]) => ({ l, a, v: seg(a, b) }));
  const total = Math.max(end, 1);
  return <div className="timing">
    {rows.map(r => <div key={r.l} className="timing-row">
      <span className="l">{r.l}</span>
      <span className="bar"><i style={r.v != null ? { left: (r.a / total * 100) + '%', width: Math.max(0.6, r.v / total * 100) + '%' } : { display: 'none' }} /></span>
      <span className="v">{r.v != null ? r.v.toFixed(1) + ' ms' : '-'}</span>
    </div>)}
  </div>;
}

function toCurl(d) {
  const q = s => "'" + String(s).replace(/'/g, `'\\''`) + "'";
  const h = Object.entries(d.headers || {}).filter(([k]) => !k.startsWith(':') && k !== 'content-length');
  return ['curl ' + q(d.url), d.method !== 'GET' ? `  -X ${d.method}` : null, ...h.map(([k, v]) => `  -H ${q(k + ': ' + v)}`), d.postData != null ? `  --data-raw ${q(d.postData)}` : null, '  --compressed'].filter(Boolean).join(' \\\n');
}
