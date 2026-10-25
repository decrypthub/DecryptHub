// 全屏页：设置 / 自动化任务。
import React, { useEffect, useState } from 'react';
import { Box, Flex, Text, Badge, Card, TextField, TextArea, SegmentedControl, Switch, Progress, Dialog, RadioCards } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { fmtK } from './state.js';
import { Button, ActionIcon, NavButton, Icon, LogoMark, EmptyState, askConfirm, Dropdown } from './kit.jsx';
import { native } from './transport.js';
import { checkForUpdate, installAndRelaunch } from './updater.js';
import { handleWindowDrag } from './window-drag.js';

export function Screens() {
  const { view, setView } = useWorkbench();
  const title = view === 'settings' ? '设置' : '自动化任务';
  return <div className="screen-wrap">
    <header className="screen-head" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      <ActionIcon icon="back" variant="soft" color="gray" onClick={() => setView('chat')} title="返回对话" />
      <span className="screen-breadcrumb">工作区</span><Icon n="chevright" size={12} /><Text size="2" weight="medium">{title}</Text>
    </header>
    {view === 'settings' ? <Settings /> : view === 'automations' ? <Automations /> : null}
  </div>;
}

const TABS = [
  ['ai', 'AI 模型', 'sparkles'],
  ['mcp', 'MCP 服务', 'tool'],
  ['browser', 'WDH 组件', 'globe'],
  ['runtime', '运行参数', 'layers'],
  ['look', '外观', 'sun'],
  ['about', '关于与更新', 'info'],
];

function Settings() {
  const w = useWorkbench();
  const [s, setS] = useState(w.settings);
  const [tab, setTab] = useState('ai');
  const [info, setInfo] = useState(null);
  const dirty = JSON.stringify(s) !== JSON.stringify(w.settings);
  useEffect(() => { native.appInfo().then(setInfo); }, []);
  useEffect(() => { setS(w.settings); }, [w.settings]);
  const up = (path, v) => setS(prev => {
    const next = JSON.parse(JSON.stringify(prev));
    const keys = path.split('.');
    let o = next;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = v;
    return next;
  });

  return <div className="settings">
    <nav className="settings-nav">
      <div className="settings-nav-label">偏好设置</div>
      {TABS.map(([k, label, icon]) => <NavButton key={k} active={tab === k} onClick={() => setTab(k)}><Icon n={icon} /><span>{label}</span></NavButton>)}
    </nav>
    <div className="settings-body">
      <div className="settings-col">
        <div className="page-intro"><h1>{TABS.find(([k]) => k === tab)?.[1]}</h1></div>
        {tab === 'ai' && <AiTab s={s} setS={setS} />}
        {tab === 'mcp' && <McpTab />}
        {tab === 'browser' && <BrowserTab s={s} up={up} />}
        {tab === 'runtime' && <RuntimeTab s={s} up={up} />}
        {tab === 'look' && <LookTab theme={localStorage.getItem('jsra_theme') || 'system'} onTheme={w.setTheme} />}
        {tab === 'about' && <AboutTab info={info} />}
      </div>
      {dirty && <div className="save-bar">
        <Text size="1" color="gray">有未保存的更改</Text>
        <Box flexGrow="1" />
        <Button size="2" variant="ghost" color="gray" onClick={() => setS(w.settings)}>还原</Button>
        <Button size="2" onClick={() => w.saveSettings(s)}><Icon n="check" size={16} />保存</Button>
      </div>}
    </div>
  </div>;
}

function Section({ title, desc, children, actions }) {
  return <section className="sec">
    <Flex align="center" gap="2" mb="2">
      <Text size="3" weight="bold">{title}</Text>
      <Box flexGrow="1" />
      {actions}
    </Flex>
    {desc && <Text as="div" size="1" color="gray" mb="2" style={{ lineHeight: 1.7 }}>{desc}</Text>}
    {children}
  </section>;
}

function Row({ label, desc, children }) {
  return <div className="field-row">
    <div className="field-label">
      <Text size="2">{label}</Text>
      {desc && <Text as="div" size="1" color="gray" style={{ lineHeight: 1.6 }}>{desc}</Text>}
    </div>
    <div className="field-ctl">{children}</div>
  </div>;
}

// ---------- AI 模型 ----------
function AiTab({ s, setS }) {
  const w = useWorkbench();
  const [edit, setEdit] = useState(null);
  const [mEdit, setMEdit] = useState(null);
  const [testing, setTesting] = useState(null);
  const list = s.providers || [];
  const activeId = s.activeProviderId || list[0]?.id;
  const patch = p => setEdit(e => ({ ...e, data: { ...e.data, ...p } }));
  const openNew = () => { setEdit({ i: -1, data: { id: 'p' + Math.random().toString(36).slice(2, 8), name: '', type: 'openai', baseUrl: 'https://api.openai.com/v1', models: [], apiKey: '' } }); };
  const openEdit = i => { setEdit({ i, data: { ...list[i], models: (list[i].models || []).map(m => typeof m === 'string' ? { id: m, name: m } : { ...m }) } }); };
  const patchModel = p => setMEdit(m => ({ ...m, data: { ...m.data, ...p } }));
  const commitModel = () => {
    if (!mEdit) return;
    const id = String(mEdit.data.id || '').trim();
    if (!id) return;
    const entry = { id, name: String(mEdit.data.name || '').trim() || id, contextWindow: Number(mEdit.data.contextWindow) || 0, vision: !!mEdit.data.vision };
    const models = [...(edit.data.models || [])];
    if (mEdit.i >= 0) models[mEdit.i] = entry; else models.push(entry);
    patch({ models });
    setMEdit(null);
  };
  const removeModel = idx => patch({ models: (edit.data.models || []).filter((_, j) => j !== idx) });
  const commit = () => {
    const d = { ...edit.data, name: (edit.data.name || '').trim() || '未命名渠道' };
    const next = edit.i >= 0 ? list.map((x, j) => j === edit.i ? d : x) : [...list, d];
    setS({ ...s, providers: next, activeProviderId: s.activeProviderId || d.id, activeModel: s.activeModel || (d.models || [])[0] || '' });
    setEdit(null);
  };
  const remove = i => {
    const gone = list[i];
    const next = list.filter((_, j) => j !== i);
    setS({ ...s, providers: next, activeProviderId: s.activeProviderId === gone.id ? (next[0]?.id || '') : s.activeProviderId });
  };
  const makeActive = p => setS({ ...s, activeProviderId: p.id, activeModel: p.models?.[0]?.id || p.models?.[0] || '' });
  const test = async p => {
    setTesting(p.id);
    try {
      const r = await window.api.invoke('test-connection', {
        providerId: p.id,
        provider: p.type,
        openai: p.type === 'openai' ? { baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.models?.[0]?.id || p.models?.[0] } : undefined,
        anthropic: p.type === 'anthropic' ? { baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.models?.[0]?.id || p.models?.[0] } : undefined,
      });
      w.toast((r.ok ? '连接正常：' : '连接失败：') + (r.message || ''), r.ok ? 'ok' : 'err', 6000);
    } catch (e) { w.toast('测试失败：' + e.message, 'err'); }
    finally { setTesting(null); }
  };

  return <>
    <Section title="模型渠道" desc="支持 OpenAI 兼容接口与 Claude 原生接口。"
      actions={<Button size="2" onClick={openNew}><Icon n="plus" size={16} />添加</Button>}>
      <Card size="2" style={{ padding: 0 }}>
        {!list.length && <EmptyState icon="sparkles" title="连接第一个模型" description="添加 OpenAI 兼容端点或 Claude 原生渠道，开启 AI 辅助分析。"><Button size="2" onClick={openNew}><Icon n="plus" size={16} />添加模型渠道</Button></EmptyState>}
        {list.map((p, i) => <div key={p.id} className={'prov-row' + (activeId === p.id ? ' on' : '')}>
          <span className="provider-icon"><Icon n={p.type === 'anthropic' ? 'sparkles' : 'code'} size={22} /></span>
          <div className="prov-main">
            <Flex align="center" gap="2" wrap="wrap">
              <Text size="2" weight="bold">{p.name || '未命名渠道'}</Text>
              {p.name !== (p.type === 'anthropic' ? 'Claude 原生' : 'OpenAI 兼容') && <Badge size="1" variant="soft" color="gray">{p.type === 'anthropic' ? 'Claude 原生' : 'OpenAI 兼容'}</Badge>}
              {activeId === p.id && <Badge size="1" variant="soft" color="tomato">使用中</Badge>}
              {!(p.hasKey || p.apiKey) && <Badge size="1" variant="soft" color="amber">没有密钥</Badge>}
            </Flex>
            <Text as="div" size="1" color="gray" mt="1">
              {(p.models || []).length ? (p.models || []).map(m => typeof m === 'string' ? m : (m.name || m.id)).join(' · ') : '还没有配置模型'}
              <Text size="1" color="gray" className="mono" style={{ marginLeft: 10 }}>{p.baseUrl}</Text>
            </Text>
          </div>
          <Flex className="row-actions" align="center" gap="2">
            {activeId !== p.id && <Button size="2" variant="soft" color="gray" onClick={() => makeActive(p)}>设为当前</Button>}
            <Button size="2" variant="soft" color="gray" disabled={testing === p.id} onClick={() => test(p)}>{testing === p.id ? '测试中…' : '测试'}</Button>
            <ActionIcon icon="edit" onClick={() => openEdit(i)} title="编辑" />
            <ActionIcon icon="trash" variant="soft" color="red" onClick={() => remove(i)} title="删除" />
          </Flex>
        </div>)}
      </Card>
    </Section>

    <Dialog.Root open={!!edit} onOpenChange={o => { if (!o) setEdit(null); }}>
      <Dialog.Content maxWidth="600px">
        <Dialog.Title size="3">{edit?.i >= 0 ? '编辑渠道' : '添加渠道'}</Dialog.Title>
        {edit && <>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">名称</Text>
            <TextField.Root size="2" value={edit.data.name} onChange={e => patch({ name: e.target.value })} placeholder="例如 OpenAI 官方 / 公司中转" /></Box>
          <Flex gap="3" mt="3">
            <Box flexGrow="1">
              <Text as="div" size="1" color="gray" mb="1">接口类型</Text>
              <SegmentedControl.Root size="2" value={edit.data.type} style={{ width: '100%' }}
                onValueChange={v => patch({ type: v, baseUrl: v === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1' })}>
                <SegmentedControl.Item value="openai" style={{ flex: 1 }}>OpenAI 兼容</SegmentedControl.Item>
                <SegmentedControl.Item value="anthropic" style={{ flex: 1 }}>Claude 原生</SegmentedControl.Item>
              </SegmentedControl.Root>
            </Box>
            <Box flexGrow="1">
              <Text as="div" size="1" color="gray" mb="1">Base URL</Text>
              <TextField.Root size="2" value={edit.data.baseUrl} onChange={e => patch({ baseUrl: e.target.value })} />
            </Box>
          </Flex>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">API Key {edit.data.hasKey && <Text size="1" color="gray">（已保存，留空表示不改）</Text>}</Text>
            <TextField.Root size="2" type="password" value={edit.data.apiKey || ''} onChange={e => patch({ apiKey: e.target.value })} placeholder={edit.data.hasKey ? '••••••••' : 'sk-…'} /></Box>
          <Box mt="3">
            <Flex justify="between" align="center" mb="2">
              <Text size="1" color="gray">模型</Text>
              <Button size="1" variant="soft" color="gray" onClick={() => setMEdit({ i: -1, data: { id: '', name: '', contextWindow: 0, vision: false } })}><Icon n="plus" size={12} />添加模型</Button>
            </Flex>
            <Flex direction="column" gap="1">
              {(edit.data.models || []).map((m, idx) => <div className="model-row" key={m.id}>
                <Icon n="sparkles" size={14} />
                <strong>{m.name || m.id}</strong>
                <span className="mono model-id">{m.id}</span>
                {m.contextWindow ? <Badge size="1" variant="soft" color="gray">{fmtK(m.contextWindow)}</Badge> : null}
                {m.vision ? <Badge size="1" variant="soft" color="gray">图片</Badge> : null}
                <Box flexGrow="1" />
                <ActionIcon icon="edit" size="1" onClick={() => setMEdit({ i: idx, data: { ...m } })} title="编辑模型" />
                <ActionIcon icon="trash" size="1" variant="soft" color="red" onClick={() => removeModel(idx)} title="删除模型" />
              </div>)}
              {!(edit.data.models || []).length && <Text size="1" color="gray">还没有模型：点「添加模型」配置 ID、上下文长度和图片能力。</Text>}
            </Flex>
          </Box>
        </>}
        <Flex justify="end" gap="2" mt="4">
          <Button size="2" variant="soft" color="gray" onClick={() => setEdit(null)}>取消</Button>
          <Button size="2" onClick={commit} disabled={!edit?.data?.baseUrl}>保存</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>

    <Dialog.Root open={!!mEdit} onOpenChange={o => { if (!o) setMEdit(null); }}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title size="3">{mEdit?.i >= 0 ? '编辑模型' : '添加模型'}</Dialog.Title>
        {mEdit && <>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">模型 ID</Text>
            <TextField.Root size="2" value={mEdit.data.id} onChange={e => patchModel({ id: e.target.value })} placeholder="deepseek-v4.1-flash" /></Box>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">展示名</Text>
            <TextField.Root size="2" value={mEdit.data.name} onChange={e => patchModel({ name: e.target.value })} placeholder="留空则用模型 ID" /></Box>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">上下文长度（tokens，留空按模型名推断）</Text>
            <TextField.Root size="2" type="number" value={mEdit.data.contextWindow || ''} onChange={e => patchModel({ contextWindow: Number(e.target.value) || 0 })} placeholder="128000" />
            <Flex gap="1" mt="2" wrap="wrap">
              {[[128000, '128K'], [256000, '256K'], [512000, '512K'], [1000000, '1M']].map(([v, l]) => (
                <Button key={v} size="1" variant={Number(mEdit.data.contextWindow) === v ? 'solid' : 'soft'} color={Number(mEdit.data.contextWindow) === v ? undefined : 'gray'}
                  onClick={() => patchModel({ contextWindow: v })}>{l}</Button>
              ))}
            </Flex>
          </Box>
          <Flex align="center" gap="2" mt="4">
            <Switch size="1" checked={!!mEdit.data.vision} onCheckedChange={v => patchModel({ vision: v })} />
            <Text size="2">支持图片输入</Text>
          </Flex>
        </>}
        <Flex justify="end" gap="2" mt="4">
          <Button size="2" variant="soft" color="gray" onClick={() => setMEdit(null)}>取消</Button>
          <Button size="2" onClick={commitModel} disabled={!String(mEdit?.data?.id || '').trim()}>保存</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  </>;
}

// ---------- 浏览器 ----------
function BrowserTab({ s, up }) {
  const w = useWorkbench();
  const [kernel, setKernel] = useState(null), [dl, setDl] = useState(null), [err, setErr] = useState('');
  const [repo, setRepo] = useState('CloakHQ/cloakbrowser'), [tag, setTag] = useState(''), [asset, setAsset] = useState('');
  const load = () => window.api.invoke('kernel-info').then(setKernel).catch(() => setKernel({}));
  useEffect(() => { load(); return window.api.on('download-progress', p => setDl(['done', 'error'].includes(p.phase) ? null : p)); }, []);
  const k = s.kernel || 'system', info = kernel?.[k], pct = dl?.total ? Math.round(dl.got / dl.total * 100) : null;
  async function download() {
    setErr(''); setDl({ phase: 'metadata', got: 0, total: 0 });
    const r = await window.api.invoke(k === 'bundled' ? 'download-chrome' : 'download-kernel', { repository: k === 'cloak' ? 'CloakHQ/cloakbrowser' : repo, tag: tag.trim(), asset: asset.trim() }).catch(e => ({ ok: false, error: e.message }));
    setDl(null); load();
    if (r.ok) { up('kernel', r.kind || 'bundled'); up('chromePath', ''); w.toast('浏览器内核已就绪，新打开浏览器时生效', 'ok'); } else setErr(r.error);
  }
  async function probe() { setErr(''); setDl({ phase: 'probe' }); const r = await window.api.invoke('probe-kernel', { kernel: k, chromePath: s.chromePath }).catch(e => ({ ok: false, error: e.message })); setDl(null); if (r.ok) w.toast('浏览器启动与画面检查通过', 'ok'); else setErr(r.error); }
  async function repair() { setErr(''); setDl({ phase: 'probe' }); const r = await window.api.invoke('kernel-repair', { kind: k }).catch(e => ({ ok: false, error: e.message })); setDl(null); if (r.ok) { w.toast('内核运行权限已修复，启动检查通过', 'ok'); load(); } else setErr(r.error); }
  if (kernel?.component && !kernel.component.installed) return <Section title="WebDecryptHub" desc="可选的浏览器分析组件。安装后可打开网页、抓取请求、调试脚本，并显示 Agent 控制状态。">
    <Text as="p" size="2">尚未安装 WDH。当前仍可使用文件、代码与外部 MCP 服务。</Text>
    {kernel.component.error && <Text as="p" color="amber" size="1">{kernel.component.error}</Text>}
    <Button variant="soft" onClick={() => navigator.clipboard.writeText('https://github.com/decrypthub/DecryptHub/blob/main/docs/components.md').then(() => w.toast('安装说明链接已复制', 'ok'))}>复制安装说明链接</Button>
    <Text as="p" size="1" color="gray">首版支持经过校验的本地组件安装；GitHub 组件目录和自动更新将在后续版本接入。</Text>
  </Section>;
  return <>
    <Section title="WebDecryptHub · 浏览器内核" desc="使用系统 Chrome / Edge、自定义 Chromium，或从 GitHub Release 下载。新设置在下次打开浏览器时生效。">
      <SegmentedControl.Root size="2" value={k} onValueChange={v => { up('kernel', v); setErr(''); }}>
        <SegmentedControl.Item value="system">系统</SegmentedControl.Item>
        <SegmentedControl.Item value="custom">自定义</SegmentedControl.Item>
        <SegmentedControl.Item value="cloak">CloakBrowser</SegmentedControl.Item>
        <SegmentedControl.Item value="github">GitHub</SegmentedControl.Item>
        <SegmentedControl.Item value="bundled">Chromium</SegmentedControl.Item>
      </SegmentedControl.Root>
      {k === 'system' && <Text as="p" size="1" color={kernel?.system ? 'gray' : 'amber'}>{kernel?.system?.path || '没有找到系统 Chrome / Edge'}</Text>}
      {k === 'custom' && <Box mt="3"><Text as="div" size="1" color="gray" mb="1">浏览器可执行文件的完整路径</Text><TextField.Root size="2" value={s.chromePath || ''} onChange={e => up('chromePath', e.target.value)} placeholder="C:\Program Files\Chromium\chrome.exe" spellCheck={false} /><Text as="p" size="1" color="gray">支持兼容 Chrome DevTools Protocol 的 Chromium 内核。</Text></Box>}
      {['cloak', 'github', 'bundled'].includes(k) && <Box mt="3">
        {k === 'cloak' && <Text as="p" size="1" color="gray">来源：CloakHQ/cloakbrowser · 官方 Release，验证发布签名与 SHA-256。</Text>}
        {k === 'github' && <Flex direction="column" gap="2"><TextField.Root aria-label="GitHub 仓库" value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/repo" /><TextField.Root aria-label="Release 标签" value={tag} onChange={e => setTag(e.target.value)} placeholder="版本标签（留空使用最新 Release）" /><TextField.Root aria-label="Release 文件名" value={asset} onChange={e => setAsset(e.target.value)} placeholder="压缩包文件名（留空按系统匹配）" /></Flex>}
        <Text as="p" size="1" color={info ? 'green' : 'gray'}>{info ? `已安装 ${info.version || ''} · ${info.verified || 'Chromium'}` : '尚未安装'}</Text>
        {dl ? <><Progress value={pct ?? 8} size="1" /><Text as="p" size="1" color="gray">{dl.phase === 'metadata' ? '读取 Release…' : dl.phase === 'probe' ? '检查内核启动…' : dl.phase === 'extract' ? '校验完成，正在解压…' : `${pct ?? ''}% · ${((dl.got || 0) / 1e6).toFixed(0)} MB`}</Text></> : <Button size="2" variant="soft" onClick={download}><Icon n="download" size={16} />{info ? '下载更新' : '下载内核'}</Button>}
      </Box>}
      {kernel?.hostIntegrity?.normal === false && <Text as="p" size="1" color="red">当前程序受 Windows 低完整性限制。请关闭旧窗口，从普通终端重新启动桌面程序。</Text>}
      <Flex mt="3" gap="2" wrap="wrap"><Button size="2" variant="soft" color="gray" disabled={!!dl} onClick={probe}>测试所选内核</Button>{info && ['cloak', 'github', 'bundled'].includes(k) && <Button size="2" variant="soft" color="gray" disabled={!!dl || kernel?.hostIntegrity?.normal === false} onClick={repair}>修复已安装内核</Button>}</Flex>
      {err && <Text as="p" size="1" color="red" role="alert">{err}</Text>}
    </Section>

    <Section title="显示">
      <Row label="主会话登录态" desc="保留：复用同一浏览器配置；每次全新：每次启动用隔离配置">
        <SegmentedControl.Root size="2" value={s.isolated ? 'iso' : 'keep'} onValueChange={v => up('isolated', v === 'iso')}>
          <SegmentedControl.Item value="keep">保留</SegmentedControl.Item>
          <SegmentedControl.Item value="iso">每次全新</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Row>
      <Row label="显示模式" desc="无头模式不弹窗口，只能看画面串流">
        <SegmentedControl.Root size="2" value={s.headless ? 'headless' : 'head'} onValueChange={v => up('headless', v === 'headless')}>
          <SegmentedControl.Item value="head">有头（推荐）</SegmentedControl.Item>
          <SegmentedControl.Item value="headless">无头</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Row>
      {!s.headless && <Row label="画面嵌入" desc="原生嵌入会把真实 Chrome 窗口贴进右侧面板；失败自动回落画面串流">
        <SegmentedControl.Root size="2" value={s.embedMode || 'auto'} onValueChange={v => up('embedMode', v)}>
          <SegmentedControl.Item value="auto">自动</SegmentedControl.Item>
          <SegmentedControl.Item value="embedded">原生嵌入</SegmentedControl.Item>
          <SegmentedControl.Item value="screencast">画面串流</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Row>}
    </Section>

    <Section title="行为">

      <Row label="代理" desc="留空表示直连">
        <TextField.Root size="2" style={{ width: 320 }} value={s.proxy || ''} onChange={e => up('proxy', e.target.value.trim())} placeholder="http://127.0.0.1:7890" spellCheck={false} />
      </Row>
    </Section>
  </>;
}

// ---------- 运行参数 ----------
function RuntimeTab({ s, up }) {
  const c = s.provider === 'anthropic' ? 'anthropic' : 'openai';
  return <>
    <Section title="任务运行">
      <Row label="工具轮数预算" desc="0 表示不限轮数，持续工作直到完成或手动停止；设置正数时，到预算后保存进展并收尾">
        <TextField.Root aria-label="工具轮数预算" size="2" type="number" style={{ width: 120 }} min="0" step="1" value={s.maxSteps ?? 0} onChange={e => up('maxSteps', Math.max(0, Math.floor(+e.target.value)))} />
      </Row>
      <Row label="Token 预算" desc="0 表示不限；按每次请求的输入和输出用量累加，与模型上下文容量分别计算">
        <TextField.Root aria-label="Token 预算" size="2" type="number" style={{ width: 120 }} min="0" step="1000" value={s.tokenBudget ?? 0} onChange={e => up('tokenBudget', Math.max(0, Math.floor(+e.target.value)))} />
      </Row>
      <Row label="温度" desc="越小越稳定，分析类任务建议 0.2 以下">
        <TextField.Root size="2" type="number" style={{ width: 120 }} step="0.1" min="0" max="1" value={s.temperature} onChange={e => up('temperature', +e.target.value)} />
      </Row>
    </Section>
    <Section title="上下文">
      <Row label="自动兜底压缩" desc="接近这个比例时先收起旧工具结果，仍超线再生成摘要；最近的对话原样保留">
        <SegmentedControl.Root size="2" value={String(s.compactAt || 0.85)} onValueChange={v => up('compactAt', +v)}>
          {[[0.8, '80%'], [0.85, '85%'], [0.9, '90%']].map(([v, l]) => <SegmentedControl.Item key={v} value={String(v)}>{l}</SegmentedControl.Item>)}
        </SegmentedControl.Root>
      </Row>
    </Section>
  </>;
}

// ---------- 外观 ----------
function LookTab({ theme, onTheme }) {
  return <Section title="主题">
    <RadioCards.Root className="theme-options" size="2" value={theme} onValueChange={onTheme} columns="3" aria-label="界面主题">{[['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']].map(([value, title]) => <RadioCards.Item key={value} value={value} className="theme-option">
      <span className={'theme-preview ' + value} aria-hidden="true"><span className="preview-rail"><i /><i /><i /></span><span className="preview-main"><i /><i /><b /></span></span>
      <span className="theme-option-label"><strong>{title}</strong>{theme === value && <Icon n="check" />}</span>
    </RadioCards.Item>)}</RadioCards.Root>
  </Section>;
}

// ---------- 关于与更新 ----------
function AboutTab({ info }) {
  const w = useWorkbench();
  const [st, setSt] = useState({ phase: 'idle' });
  const [upd, setUpd] = useState(null);
  const [prog, setProg] = useState(null);
  const check = async () => {
    setSt({ phase: 'checking' }); setUpd(null); setProg(null);
    const r = await checkForUpdate();
    if (r.error) { setSt({ phase: 'error', error: r.error }); return; }
    if (!r.available) { setSt({ phase: 'none' }); return; }
    setUpd(r); setSt({ phase: 'available' });
  };
  const install = async () => {
    if (!upd?.raw) return;
    setSt({ phase: 'downloading' });
    try { await installAndRelaunch(upd.raw, p => { if (p.event === 'Installing') setSt({ phase: 'installing' }); setProg(p); }); }
    catch (e) { setSt({ phase: 'error', error: String(e?.message || e) }); }
  };
  const pct = prog?.contentLength ? Math.min(100, Math.round(100 * (prog.downloaded || 0) / prog.contentLength)) : null;
  const busy = ['checking', 'downloading', 'installing'].includes(st.phase);
  return <>
    <Section title="软件更新" desc={`当前版本 ${info?.version || '—'} · 通过 GitHub Releases 检查`}>
      <Flex align="center" gap="2" wrap="wrap">
        <Button size="2" variant="soft" color="gray" disabled={busy} onClick={check}>{st.phase === 'checking' ? '检查中…' : '检查更新'}</Button>
        {st.phase === 'available' && <Button size="2" onClick={install}>下载并安装 {upd?.version}</Button>}
        {st.phase === 'none' && <Text size="1" color="green">已是最新</Text>}
        {st.phase === 'error' && <Text size="1" color="red">{st.error}</Text>}
      </Flex>
      {(st.phase === 'downloading' || st.phase === 'installing') && <Box mt="2"><Progress value={pct ?? 8} size="1" /><Text as="div" size="1" color="gray" mt="1">{st.phase === 'installing' ? '正在安装…' : (pct != null ? pct + '%' : '下载中…')}</Text></Box>}
      {st.phase === 'available' && upd && <Card size="1" mt="3"><Text size="2" weight="bold">v{upd.version}</Text>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, maxHeight: 160, overflow: 'auto', margin: '6px 0 0', color: 'var(--gray-11)' }}>{upd.notes || '（无更新说明）'}</pre></Card>}
    </Section>

    <Section title="关于">
      <Flex align="center" gap="3" mb="3">
        <LogoMark size={28} />
        <div>
          <Text size="2" weight="bold">DecryptHub</Text> <Text size="1" color="gray">{info?.version || ''}</Text>
          <Text as="div" size="1" color="gray">{info ? `${info.os} / ${info.arch} · 密钥：${info.keyringBackend}` : ''}</Text>
        </div>
      </Flex>
      <Button size="2" variant="soft" color="gray" onClick={async () => {
        const r = await window.api.invoke('export-diagnostics').catch(e => ({ ok: false, error: e.message }));
        r.ok ? w.toast('诊断信息已导出：' + r.path, 'ok', 7000) : w.toast('导出失败：' + r.error, 'err');
      }}><Icon n="file" size={16} />导出诊断信息</Button>
      <Text as="div" size="1" color="gray" mt="3" style={{ lineHeight: 1.7 }}>通用桌面 Agent，支持项目开发、文件处理、浏览网页和外部 MCP 工具。</Text>
    </Section>
  </>;
}

// ---------- 自动化任务 ----------
const DAYS = ['日', '一', '二', '三', '四', '五', '六'];
function Automations() {
  const w = useWorkbench();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);
  const load = async () => { try { setList(await w.api.invoke('tasks-list') || []); } catch {} };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []);
  const blank = { title: '', prompt: '', time: '09:00', days: [1, 2, 3, 4, 5], enabled: true, sessionId: w.sid || '' };
  const save = async () => {
    if (!form.prompt.trim()) { w.toast('先写清楚要 AI 做什么', 'warn'); return; }
    try { await w.api.invoke('task-save', { task: form }); setForm(null); await load(); w.toast('已保存', 'ok'); }
    catch (e) { w.toast('保存失败：' + e.message, 'err'); }
  };
  const run = async id => {
    try { const r = await w.api.invoke('task-run', { id }); if (!r.ok) throw new Error(r.error); await load(); w.toast('已启动，可在绑定会话查看进度', 'ok'); }
    catch (e) { w.toast('运行失败：' + e.message, 'err'); }
  };
  const remove = async id => {
    if (!await askConfirm('删除这个任务？', { ok: '删除', danger: true })) return;
    await w.api.invoke('task-remove', { id }); await load();
  };
  return <div className="scroll-body">
    <div className="page automations-page">
      <div className="page-intro with-action"><h1>自动化任务</h1><Button size="2" onClick={() => setForm({ ...blank })}><Icon n="plus" size={16} />新建任务</Button></div>
      <div className="automation-notice"><Icon n="info" size={15} /><span>按计划运行，需保持应用打开。</span><span className="automation-count">{list.filter(t => t.enabled).length} 个已启用</span></div>

      {form && <Card size="2" mb="4">
        <Flex gap="3" mb="3">
          <Box flexGrow="1"><Text as="div" size="1" color="gray" mb="1">任务名</Text>
            <TextField.Root size="2" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="例如：每天早上看一眼竞品接口" /></Box>
          <Box width="130px"><Text as="div" size="1" color="gray" mb="1">时间</Text>
            <TextField.Root size="2" type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></Box>
        </Flex>
        <Box mb="3"><Text as="div" size="1" color="gray" mb="1">要 AI 做什么</Text>
          <TextArea size="2" rows={4} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} placeholder="例如：打开 https://example.com，看它首页调了哪些接口，把新增的参数记到 findings.md" /></Box>
        <Box mb="3"><Text as="div" size="1" color="gray" mb="1">执行会话</Text><Dropdown label="执行会话" value={form.sessionId || ''} options={[{ value: 'new-managed', label: '独立会话工作区' }, ...w.sessions.sessions.map(s => ({ value: s.id, label: s.title + ' · ' + (s.workspace?.label || '会话工作区') }))]} onChange={value => setForm({ ...form, sessionId: value === 'new-managed' ? '' : value })} placeholder="独立会话工作区" /><Text as="div" size="1" color="gray" mt="1">使用该会话的文件夹和权限；遇到新权限时标记为待处理。</Text></Box>
        <Flex align="center" gap="2" mb="3" wrap="wrap">
          <Text size="1" color="gray">星期</Text>
          {DAYS.map((d, i) => <Button key={i} size="2" variant={form.days.includes(i) ? 'solid' : 'soft'} color={form.days.includes(i) ? undefined : 'gray'}
            onClick={() => setForm({ ...form, days: form.days.includes(i) ? form.days.filter(x => x !== i) : [...form.days, i] })}>{d}</Button>)}
        </Flex>
        <Flex align="center" gap="2">
          <Text size="1" as="label"><Flex align="center" gap="1"><Switch size="1" checked={form.enabled} onCheckedChange={v => setForm({ ...form, enabled: v })} />启用</Flex></Text>
          <Box flexGrow="1" />
          <Button size="2" variant="soft" color="gray" onClick={() => setForm(null)}>取消</Button>
          <Button size="2" onClick={save}>保存</Button>
        </Flex>
      </Card>}

      <Card className="automation-list" size="2" style={{ padding: 0 }}>
        {!list.length && !form && <EmptyState icon="clock" title="暂无任务" />}
        {list.map(t => <div key={t.id} className="task-row">
          <span className="task-icon"><Icon n="clock" size={20} /></span>
          <div className="task-main">
            <Flex align="center" gap="2"><Text size="2" weight="bold">{t.title || '未命名任务'}</Text>{!t.enabled && <Badge size="1" variant="soft" color="gray">已停用</Badge>}{t.lastStatus && <Badge size="1" variant="soft" color={t.lastStatus === 'error' ? 'red' : t.lastStatus === 'needs_attention' ? 'amber' : 'gray'}>{{ running: '运行中', ok: '已完成', error: '失败', needs_attention: '待处理' }[t.lastStatus]}</Badge>}</Flex>
            <Text as="div" size="1" color="gray" mt="1">
              每天 {t.time} · {(t.days || []).length === 7 ? '每天' : (t.days || []).map(d => '周' + DAYS[d]).join(' ')}
              {t.nextAt ? ` · 下次 ${new Date(t.nextAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : ' · 未排期'}
            </Text>
          </div>
          <Flex className="row-actions" align="center" gap="2">
            <Button size="2" variant="soft" color="gray" disabled={t.lastStatus === 'running'} onClick={() => run(t.id)}>立即运行</Button>
            <ActionIcon icon="edit" onClick={() => setForm({ ...t })} title="编辑" />
            <ActionIcon icon="trash" variant="soft" color="red" onClick={() => remove(t.id)} title="删除" />
          </Flex>
        </div>)}
      </Card>
    </div>
  </div>;
}

// ---------- MCP 服务 ----------
// 参考 Cherry Studio / Cline / Claude Desktop：服务列表 + 状态 + 启用开关，
// stdio / HTTP / SSE 三种传输，支持 mcpServers JSON 直接导入。
const MCP_TRANSPORT = [['stdio', '本地进程'], ['http', 'HTTP'], ['sse', 'SSE']];
const MCP_STATE = {
  'needs-approval': ['等待批准启动', 'pend'],
  ready: ['已连接', 'ok'],
  connecting: ['连接中', 'pend'],
  error: ['连接失败', 'bad'],
  disabled: ['已停用', 'off'],
  idle: ['未启动', 'off'],
};

function parseEnv(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
function parseHeaders(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf(':');
    if (i <= 0) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
const kvLines = obj => Object.entries(obj || {}).map(([k, v]) => `${k}=${v}`).join('\n');
const headerLines = obj => Object.entries(obj || {}).map(([k, v]) => `${k}: ${v}`).join('\n');

function mcpDraftOf(name, cfg = {}) {
  return {
    name,
    enabled: cfg.enabled !== false,
    transport: cfg.transport || 'stdio',
    command: cfg.command || '',
    argsText: (cfg.args || []).join('\n'),
    envText: kvLines(cfg.env),
    cwd: cfg.cwd || '',
    url: cfg.url || '',
    headersText: headerLines(cfg.headers),
  };
}
function mcpConfigOf(d) {
  return {
    enabled: !!d.enabled,
    transport: d.transport,
    command: (d.command || '').trim(),
    args: String(d.argsText || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    env: parseEnv(d.envText),
    cwd: (d.cwd || '').trim(),
    url: (d.url || '').trim(),
    headers: parseHeaders(d.headersText),
  };
}

function McpTab() {
  const w = useWorkbench();
  const [list, setList] = useState([]);
  const [edit, setEdit] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [openTools, setOpenTools] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErr, setImportErr] = useState('');
  const [busy, setBusy] = useState({});

  const refresh = () => w.inv('mcp-status').then(setList).catch(() => {});
  useEffect(() => { refresh(); return w.api.on('mcp-status', setList); }, []);

  const serversOf = () => Object.fromEntries(list.map(x => [x.name, { ...(x.config || {}), enabled: x.enabled, transport: x.transport }]));
  const saveServers = async (servers, approveNames = []) => {
    try { const r = await w.inv('mcp-save', { servers, approveNames }); setList(r); return true; }
    catch (e) { w.toast('保存失败：' + e.message, 'err'); return false; }
  };

  const openNew = () => { setTest(null); setEdit({ cfgName: null, draft: mcpDraftOf('', { enabled: true, transport: 'stdio', command: 'npx' }) }); };
  const openEdit = x => { setTest(null); setEdit({ cfgName: x.name, draft: mcpDraftOf(x.name, { ...(x.config || {}), enabled: x.enabled, transport: x.transport }) }); };
  const patch = p => setEdit(e => ({ ...e, draft: { ...e.draft, ...p } }));

  const commit = async () => {
    const d = edit.draft;
    const name = (d.name || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(name)) { w.toast('名称只能用字母、数字、下划线、点或短横线，且以字母或数字开头', 'warn'); return; }
    const cfg = mcpConfigOf(d);
    if (cfg.transport === 'stdio' && !cfg.command) { w.toast('请填写启动命令', 'warn'); return; }
    if (cfg.transport !== 'stdio' && !/^https?:\/\//i.test(cfg.url)) { w.toast('请填写 http(s):// 开头的服务地址', 'warn'); return; }
    const servers = serversOf();
    if (edit.cfgName && edit.cfgName !== name) delete servers[edit.cfgName];
    servers[name] = cfg;
    if (await saveServers(servers, [name])) setEdit(null);
  };

  const toggle = async (x, on) => {
    const servers = serversOf();
    servers[x.name] = { ...servers[x.name], enabled: on };
    setBusy(b => ({ ...b, [x.name]: 'save' }));
    await saveServers(servers, on ? [x.name] : []);
    setBusy(b => ({ ...b, [x.name]: '' }));
  };
  const restart = async x => {
    setBusy(b => ({ ...b, [x.name]: 'restart' }));
    try { setList(await w.inv('mcp-restart', { name: x.name })); }
    catch (e) { w.toast('重新连接失败：' + e.message, 'err'); }
    finally { setBusy(b => ({ ...b, [x.name]: '' })); }
  };
  const remove = async x => {
    if (!await askConfirm(`删除 MCP 服务「${x.name}」？其工具会立刻从对话里移除。`, { ok: '删除', danger: true })) return;
    const servers = serversOf();
    delete servers[x.name];
    await saveServers(servers);
  };

  const runTest = async () => {
    setTesting(true); setTest(null);
    try { setTest(await w.inv('mcp-test', { name: edit.draft.name || 'test', ...mcpConfigOf(edit.draft) })); }
    catch (e) { setTest({ ok: false, error: e.message }); }
    finally { setTesting(false); }
  };

  const doImport = async () => {
    setImportErr('');
    try {
      const parsed = JSON.parse(importText);
      const src = parsed.mcpServers || parsed['mcp-servers'] || parsed;
      if (!src || typeof src !== 'object' || Array.isArray(src)) throw new Error('没有找到 mcpServers 对象');
      const servers = serversOf();
      let n = 0;
      for (const [name, cfg] of Object.entries(src)) {
        if (!cfg || typeof cfg !== 'object') continue;
        servers[name] = { ...cfg, enabled: false, transport: cfg.transport || (cfg.url ? 'http' : 'stdio') };
        n++;
      }
      if (!n) throw new Error('没有可导入的服务');
      if (await saveServers(servers)) { setImportOpen(false); setImportText(''); w.toast(`已导入 ${n} 个 MCP 服务，请逐个启用`, 'ok'); }
    } catch (e) { setImportErr('导入失败：' + e.message); }
  };

  return <>
    <Section title="已接入的服务" desc="接入外部工具服务：本地 stdio 服务以当前系统用户权限运行；只接入你信任的命令。保存并启用后连接，导入的服务默认关闭。"
      actions={<Flex gap="2">
        <Button size="2" variant="soft" color="gray" onClick={() => { setImportErr(''); setImportOpen(true); }}><Icon n="download" size={16} />导入 JSON</Button>
        <Button size="2" onClick={openNew}><Icon n="plus" size={16} />添加服务</Button>
      </Flex>}>
      <Card className="mcp-list" size="2" style={{ padding: 0 }}>
        {!list.length && <EmptyState icon="tool" title="还没有接入 MCP 服务" description="支持 Claude Desktop / Cursor 的 mcpServers 配置，可直接粘贴导入。" />}
        {list.map(x => {
          const [label, tone] = MCP_STATE[x.state] || ['未知', 'off'];
          const expanded = openTools === x.name;
          const cfg = x.config || {};
          return <div className={'mcp-row' + (x.enabled ? '' : ' is-off')} key={x.name}>
            <div className="mcp-main">
              <div className="mcp-title">
                <strong>{x.name}</strong>
                <Badge size="1" variant="soft" color="gray">{MCP_TRANSPORT.find(t => t[0] === x.transport)?.[1] || x.transport}</Badge>
                <span className={'mcp-state ' + tone}>{label}{x.state === 'ready' ? ` · ${x.toolCount} 个工具` : ''}</span>
              </div>
              {x.state === 'error'
                ? <div className="mcp-error" title={x.error}>{x.error}</div>
                : x.state === 'ready'
                  ? <button type="button" className="mcp-tools-toggle" onClick={() => setOpenTools(expanded ? null : x.name)}>{expanded ? '收起工具' : `查看 ${x.toolCount} 个工具`}<Icon n={expanded ? 'chevup' : 'chevdown'} size={12} /></button>
                  : <div className="mcp-hint" title={x.transport === 'stdio' ? cfg.command : cfg.url}>{x.transport === 'stdio' ? [cfg.command, ...(cfg.args || [])].join(' ') : cfg.url}</div>}
              {expanded && <div className="mcp-tools">
                {x.tools.map(t => <div key={t.name} className="mcp-tool"><span className="mono">{t.name}</span><span title={t.description}>{t.description}</span></div>)}
              </div>}
            </div>
            <div className="mcp-actions">
              <Switch size="1" checked={x.enabled} disabled={busy[x.name] === 'save'} onCheckedChange={v => toggle(x, v)} />
              <ActionIcon icon="reload" onClick={() => restart(x)} title="重新连接" disabled={busy[x.name] === 'restart' || x.state === 'connecting'} />
              <ActionIcon icon="edit" onClick={() => openEdit(x)} title="编辑" />
              <ActionIcon icon="trash" variant="soft" color="red" onClick={() => remove(x)} title="删除" />
            </div>
          </div>;
        })}
      </Card>
    </Section>

    {edit && <Dialog.Root open onOpenChange={v => { if (!v) setEdit(null); }}>
      <Dialog.Content maxWidth="660px">
        <Dialog.Title>{edit.cfgName ? '编辑 MCP 服务' : '添加 MCP 服务'}</Dialog.Title>
        <Dialog.Description size="2" color="gray">本地进程用命令加参数启动；HTTP / SSE 填服务地址。工具名会自动加「服务名__」前缀。</Dialog.Description>
        <Flex gap="3" mt="4" wrap="wrap" align="end">
          <Box flexGrow="1" style={{ minWidth: 220 }}>
            <Text as="div" size="1" color="gray" mb="1">名称</Text>
            <TextField.Root value={edit.draft.name} onChange={e => patch({ name: e.target.value })} placeholder="filesystem" />
          </Box>
          <Box>
            <Text as="div" size="1" color="gray" mb="1">传输</Text>
            <SegmentedControl.Root value={edit.draft.transport} onValueChange={v => { patch({ transport: v }); setTest(null); }}>
              {MCP_TRANSPORT.map(([k, l]) => <SegmentedControl.Item key={k} value={k}>{l}</SegmentedControl.Item>)}
            </SegmentedControl.Root>
          </Box>
        </Flex>
        {edit.draft.transport === 'stdio' ? <>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">命令</Text>
            <TextField.Root value={edit.draft.command} onChange={e => patch({ command: e.target.value })} placeholder="npx" /></Box>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">参数（每行一个）</Text>
            <TextArea rows={4} className="mono" value={edit.draft.argsText} onChange={e => patch({ argsText: e.target.value })} placeholder={'-y\n@modelcontextprotocol/server-filesystem\nC:\\data'} /></Box>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">环境变量（KEY=VALUE，每行一个）</Text>
            <TextArea rows={3} className="mono" value={edit.draft.envText} onChange={e => patch({ envText: e.target.value })} placeholder="GITHUB_TOKEN=..." /></Box>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">工作目录（可选）</Text>
            <TextField.Root value={edit.draft.cwd} onChange={e => patch({ cwd: e.target.value })} placeholder="默认使用应用数据目录下的 mcp/" /></Box>
        </> : <>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">服务地址</Text>
            <TextField.Root value={edit.draft.url} onChange={e => patch({ url: e.target.value })} placeholder="https://example.com/mcp" /></Box>
          <Box mt="3"><Text as="div" size="1" color="gray" mb="1">请求头（KEY: VALUE，每行一个）</Text>
            <TextArea rows={3} className="mono" value={edit.draft.headersText} onChange={e => patch({ headersText: e.target.value })} placeholder="Authorization: Bearer ..." /></Box>
        </>}
        {test && <div className={'mcp-test ' + (test.ok ? 'ok' : 'bad')}>
          <Text size="2" weight="medium">{test.ok ? `连接成功 · ${test.tools.length} 个工具` : '连接失败：' + test.error}</Text>
          {test.ok && test.tools.length > 0 && <div className="mcp-test-tools">{test.tools.map(t => t.name).join('、')}</div>}
        </div>}
        <Flex align="center" gap="2" mt="4">
          <Text size="1" as="label"><Flex align="center" gap="1"><Switch size="1" checked={edit.draft.enabled} onCheckedChange={v => patch({ enabled: v })} />启用</Flex></Text>
          <Button size="2" variant="soft" color="gray" onClick={runTest} loading={testing}><Icon n="bolt" size={16} />启动并测试</Button>
          <Box flexGrow="1" />
          <Button size="2" variant="soft" color="gray" onClick={() => setEdit(null)}>取消</Button>
          <Button size="2" onClick={commit}><Icon n="check" size={16} />保存</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>}

    {importOpen && <Dialog.Root open onOpenChange={setImportOpen}>
      <Dialog.Content maxWidth="620px">
        <Dialog.Title>导入 MCP 配置</Dialog.Title>
        <Dialog.Description size="2" color="gray">粘贴 Claude Desktop / Cursor 的 mcpServers JSON；同名服务会被覆盖。</Dialog.Description>
        <TextArea mt="3" rows={9} className="mono" value={importText} onChange={e => setImportText(e.target.value)}
          placeholder={'{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\data"]\n    }\n  }\n}'} />
        {importErr && <Text as="div" size="1" color="red" mt="2">{importErr}</Text>}
        <Flex justify="end" gap="2" mt="4">
          <Button size="2" variant="soft" color="gray" onClick={() => setImportOpen(false)}>取消</Button>
          <Button size="2" onClick={doImport} disabled={!importText.trim()}><Icon n="download" size={16} />导入</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>}
  </>;
}
