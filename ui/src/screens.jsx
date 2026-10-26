// 全屏页：设置 / 自动化任务。
import React, { useEffect, useState } from 'react';
import { Box, Flex, Text, Badge, Card, TextField, TextArea, SegmentedControl, Switch, Progress, Dialog, RadioCards } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { fmtK } from './state.js';
import { Button, ActionIcon, NavButton, Icon, LogoMark, EmptyState, askConfirm, Dropdown } from './kit.jsx';
import { native } from './transport.js';
import { checkForUpdate, installAndRelaunch } from './updater.js';
import { PluginCenter } from './plugins.jsx';
import { Section, Row } from './settings-kit.jsx';
import { handleWindowDrag } from './window-drag.js';

export function Screens() {
  const { view, setView } = useWorkbench();
  const title = view === 'settings' ? '设置' : view === 'plugins' ? '插件' : '自动化任务';
  return <div className="screen-wrap">
    <header className="screen-head" data-window-drag-region onMouseDown={e => handleWindowDrag(e, native)}>
      <ActionIcon icon="back" variant="soft" color="gray" onClick={() => setView('chat')} title="返回对话" />
      <span className="screen-breadcrumb">工作区</span><Icon n="chevright" size={12} /><Text size="2" weight="medium">{title}</Text>
    </header>
    {view === 'plugins' ? <PluginCenter /> : view === 'settings' ? <Settings /> : view === 'automations' ? <Automations /> : null}
  </div>;
}

const TABS = [
  ['ai', 'AI 模型', 'sparkles'],
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
  const load = async () => { try { setList(await w.api.invoke('tasks-list') || []); } catch (e) { w.toast('无法读取自动化：' + e.message, 'err'); } };
  useEffect(() => { load(); const off = w.api.on('tasks-status', setList), t = setInterval(load, 15000); return () => { off(); clearInterval(t); }; }, []);
  const blank = { title: '', prompt: '', time: '09:00', days: [1, 2, 3, 4, 5], enabled: true, sessionId: w.sid || '' };
  useEffect(() => { if (w.automationDraft) { setForm({ ...blank }); w.setAutomationDraft(false); } }, [w.automationDraft]);
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
            {t.lastError && <Text as="div" size="1" color={t.lastStatus === 'needs_attention' ? 'amber' : 'red'} mt="1">{t.lastError}</Text>}
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
