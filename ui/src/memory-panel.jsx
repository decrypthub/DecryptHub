// 设置 → 记忆与技能：管理 AI 自己写的长期记忆和可复用技能。
//
// 三类内容的边界（与 sidecar/system-memory.mjs 一致）：
//   · 系统记忆：产品内置 + 插件在 MCP initialize 里声明的环境事实。只读，本页可查看正文、不提供编辑。
//   · 记忆：AI 通过 memory_manage 维护，也可由用户在这里删除。
//   · 技能：AI 通过 skill_manage 维护，SKILL.md 带 name/description frontmatter。
// 删除走独立 RPC（extension-admin-remove），必须带明确 scope + scopeId，不会按名字猜作用域。
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Box, Card, Flex, Text } from '@radix-ui/themes';
import { Button, Icon, EmptyState, askConfirm } from './kit.jsx';
import { Section } from './settings-kit.jsx';
import { useWorkbench } from './bus.jsx';

const KINDS = [
  ['memory', '记忆', '长期事实、用户偏好与已验证结论'],
  ['skill', '技能', '可复用的多步工作流'],
];

const SCOPES = { session: '会话', project: '项目', user: '全局' };

// 作用域 ID 只是内部文件名（项目/会话 ID）。展示时尽量换成可读名字，找不到就直说。
function scopeLabel(item, projects, sessions) {
  if (item.scope === 'user') return '全局 · 所有项目';
  if (item.scope === 'project') return '项目 · ' + (projects.find(p => p.id === item.scopeId)?.name || item.scopeId);
  return '会话 · ' + (sessions.find(s => s.id === item.scopeId)?.title || item.scopeId);
}

function when(ms) {
  if (!ms) return '';
  const d = new Date(ms), diff = Date.now() - d.getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' 天前';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });
}

export function MemoryPanel() {
  const w = useWorkbench();
  const projects = w.projects || [], sessions = w.sessions?.sessions || [];
  const [kind, setKind] = useState('memory');
  const [items, setItems] = useState([]);
  const [sources, setSources] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async target => {
    const want = target || kind;
    setError(''); setBusy(true);
    try {
      const next = await w.api.invoke('extensions-admin', { kind: want }) || [];
      // 请求返回时可能已经切到另一个类型：晚到的结果不能写进当前列表。
      if (want === kind) setItems(next);
    } catch (e) {
      if (want === kind) { setError(e.message || String(e)); setItems([]); }
    } finally { setBusy(false); }
  }, [w.api, kind]);

  useEffect(() => { setSelected(null); load(kind); }, [kind, load]);
  useEffect(() => {
    w.api.invoke('system-memory-sources').then(setSources).catch(() => setSources(null));
    const off = w.api.on('extensions-changed', () => load(kind));
    return () => off?.();
  }, [w.api, kind, load]);

  // 全局作用域排最前：它跨项目生效，删除影响最大，需要先被看见。
  const grouped = useMemo(() => {
    const order = { user: 0, project: 1, session: 2 };
    return [...items].sort((a, b) => (order[a.scope] - order[b.scope]) || String(a.name).localeCompare(String(b.name)));
  }, [items]);

  const open = async item => {
    setError('');
    try { setSelected({ ...(await w.api.invoke('extension-admin-read', { kind, name: item.name, scope: item.scope, scopeId: item.scopeId })), scopeId: item.scopeId }); }
    catch (e) { setError(e.message || String(e)); }
  };

  const remove = async item => {
    const label = kind === 'skill' ? '技能' : '记忆';
    if (!await askConfirm(`删除${label}「${item.name}」？\n\n范围：${scopeLabel(item, projects, sessions)}。删除后无法恢复。`, { ok: '删除', danger: true })) return;
    setError('');
    try {
      await w.api.invoke('extension-admin-remove', { kind, name: item.name, scope: item.scope, scopeId: item.scopeId });
      w.toast(`已删除${label}「${item.name}」`, 'ok');
      setSelected(null); await load();
    } catch (e) { setError(e.message || String(e)); }
  };

  const current = KINDS.find(([k]) => k === kind);
  return <>
    <Section title="记忆与技能" desc="AI 在工作里自己维护的内容。全局作用域对所有项目生效；项目与会话作用域只影响对应范围。">
      <Flex gap="2" wrap="wrap" align="center">
        {KINDS.map(([k, label]) => <Button key={k} size="2" variant={kind === k ? 'solid' : 'soft'} color={kind === k ? undefined : 'gray'} onClick={() => setKind(k)}>
          <Icon n={k === 'memory' ? 'layers' : 'tool'} size={15} />{label}
        </Button>)}
        <Box flexGrow="1" />
        <Button size="2" variant="soft" color="gray" disabled={busy} onClick={() => load()}>{busy ? '读取中…' : '刷新'}</Button>
      </Flex>
      <Text as="div" size="1" color="gray" mt="2" style={{ lineHeight: 1.7 }}>{current[2]}。共 {items.length} 条。</Text>
    </Section>

    <Section title={current[1] + '列表'}>
      <Card size="2" style={{ padding: 0 }}>
        {!items.length && !busy && <EmptyState compact icon={kind === 'memory' ? 'layers' : 'tool'} title={'还没有' + current[1]}
          description={kind === 'memory' ? '在对话里纠正 AI 的环境判断，或让它记住已验证的结论，就会出现在这里。' : '在对话里用 /skill，或让 AI 保存一套可复用流程，就会出现在这里。'} />}
        {grouped.map(item => <div key={item.scope + item.scopeId + item.name} className="ext-row">
          <button type="button" className="ext-open" onClick={() => open(item)} aria-label={`查看${current[1]} ${item.name}`}>
            <Icon n={kind === 'memory' ? 'layers' : 'tool'} size={15} />
            <span>
              <strong>{item.name}</strong>
              <small>{item.description || '（无描述）'}</small>
              <small>{scopeLabel(item, projects, sessions)}{item.updatedAt ? ' · ' + when(item.updatedAt) : ''}</small>
            </span>
          </button>
          <Badge size="1" variant="soft" color={item.scope === 'user' ? 'tomato' : 'gray'}>{SCOPES[item.scope] || item.scope}</Badge>
          <Button size="1" variant="soft" color="gray" onClick={() => open(item)}>查看</Button>
          <Button size="1" variant="soft" color="red" onClick={() => remove(item)}>删除</Button>
        </div>)}
      </Card>
      {error && <Text as="p" size="2" color="red" role="alert" mt="2">{error}</Text>}
    </Section>

    {selected && <Section title={'内容 · ' + selected.name} desc={scopeLabel(selected, projects, sessions)}>
      <Card size="2" style={{ padding: 0 }}>
        <Box className="extension-preview" style={{ maxHeight: 420 }}><pre className="ext-text">{selected.content}</pre></Box>
      </Card>
      <Flex justify="end" mt="3"><Button size="2" variant="soft" color="gray" onClick={() => setSelected(null)}>收起</Button></Flex>
    </Section>}

    <Section title="系统记忆" desc="产品与已连接插件声明的环境事实，例如这台手机可以用设备通道操作。只读、不授予权限，也不在这里编辑。">
      <Card size="2">
        <Flex direction="column" gap="2">
          {(sources?.sources || []).map(source => <details className="system-memory-entry" key={source.id || source.label}>
            <summary><Icon n="key" size={14} /><span>{source.label}</span><Badge size="1" variant="soft" color="gray">内置 · 只读</Badge><Icon n="chevdown" size={13} /></summary>
            <pre className="ext-text">{source.content}</pre>
          </details>)}
          {(sources?.pluginInstructions || []).map(plugin => <details className="system-memory-entry" key={plugin.name}>
            <summary><Icon n="mobile" size={14} /><span>{plugin.name}{plugin.version ? ' · v' + plugin.version : ''}</span><Badge size="1" variant="soft" color="gray">插件声明 · 只读</Badge><Icon n="chevdown" size={13} /></summary>
            <pre className="ext-text">{plugin.content}</pre>
          </details>)}
          {!sources && <Text size="1" color="gray">读取中…</Text>}
          {sources && !sources.pluginInstructions?.length && <Text as="div" size="1" color="gray" style={{ lineHeight: 1.7 }}>
            目前没有插件声明环境说明。连接 ADH / IDH 后，它们对设备的说明会自动进入系统记忆。
          </Text>}
        </Flex>
      </Card>
    </Section>
  </>;
}
