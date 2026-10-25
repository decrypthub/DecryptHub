import React, { useEffect, useState } from 'react';
import {
  Box,
  Flex,
  Text,
  Badge,
  Card,
  TextField,
  TextArea,
  SegmentedControl,
  Switch,
  Progress,
  Dialog,
  RadioCards,
} from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, Icon, EmptyState, askConfirm } from './kit.jsx';
import { Section, Row } from './settings-kit.jsx';
// ---------- MCP 服务 ----------
// 参考 Cherry Studio / Cline / Claude Desktop：服务列表 + 状态 + 启用开关，
// stdio / HTTP / SSE 三种传输，支持 mcpServers JSON 直接导入。
const MCP_TRANSPORT = [
  ['stdio', '本地进程'],
  ['http', 'HTTP'],
  ['sse', 'SSE'],
];
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
const kvLines = (obj) =>
  Object.entries(obj || {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
const headerLines = (obj) =>
  Object.entries(obj || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

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
    args: String(d.argsText || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
    env: parseEnv(d.envText),
    cwd: (d.cwd || '').trim(),
    url: (d.url || '').trim(),
    headers: parseHeaders(d.headersText),
  };
}

export function McpServices() {
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

  const refresh = () =>
    w
      .inv('mcp-status')
      .then(setList)
      .catch(() => {});
  useEffect(() => {
    refresh();
    return w.api.on('mcp-status', setList);
  }, []);

  const serversOf = () =>
    Object.fromEntries(
      list.map((x) => [x.name, { ...(x.config || {}), enabled: x.enabled, transport: x.transport }]),
    );
  const saveServers = async (servers, approveNames = []) => {
    try {
      const r = await w.inv('mcp-save', { servers, approveNames });
      setList(r);
      return true;
    } catch (e) {
      w.toast('保存失败：' + e.message, 'err');
      return false;
    }
  };

  const openNew = () => {
    setTest(null);
    setEdit({ cfgName: null, draft: mcpDraftOf('', { enabled: true, transport: 'stdio', command: 'npx' }) });
  };
  const openEdit = (x) => {
    setTest(null);
    setEdit({
      cfgName: x.name,
      draft: mcpDraftOf(x.name, { ...(x.config || {}), enabled: x.enabled, transport: x.transport }),
    });
  };
  const patch = (p) => setEdit((e) => ({ ...e, draft: { ...e.draft, ...p } }));

  const commit = async () => {
    const d = edit.draft;
    const name = (d.name || '').trim();
    if (['decrypthub_idh', 'decrypthub_adh'].includes(name)) {
      w.toast('官方插件请在插件详情中配置', 'warn');
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(name)) {
      w.toast('名称只能用字母、数字、下划线、点或短横线，且以字母或数字开头', 'warn');
      return;
    }
    const cfg = mcpConfigOf(d);
    if (cfg.transport === 'stdio' && !cfg.command) {
      w.toast('请填写启动命令', 'warn');
      return;
    }
    if (cfg.transport !== 'stdio' && !/^https?:\/\//i.test(cfg.url)) {
      w.toast('请填写 http(s):// 开头的服务地址', 'warn');
      return;
    }
    const servers = serversOf();
    if (edit.cfgName && edit.cfgName !== name) delete servers[edit.cfgName];
    servers[name] = cfg;
    if (await saveServers(servers, [name])) setEdit(null);
  };

  const toggle = async (x, on) => {
    const servers = serversOf();
    servers[x.name] = { ...servers[x.name], enabled: on };
    setBusy((b) => ({ ...b, [x.name]: 'save' }));
    await saveServers(servers, on ? [x.name] : []);
    setBusy((b) => ({ ...b, [x.name]: '' }));
  };
  const restart = async (x) => {
    setBusy((b) => ({ ...b, [x.name]: 'restart' }));
    try {
      setList(await w.inv('mcp-restart', { name: x.name }));
    } catch (e) {
      w.toast('重新连接失败：' + e.message, 'err');
    } finally {
      setBusy((b) => ({ ...b, [x.name]: '' }));
    }
  };
  const remove = async (x) => {
    if (
      !(await askConfirm(`删除 MCP 服务「${x.name}」？其工具会立刻从对话里移除。`, {
        ok: '删除',
        danger: true,
      }))
    )
      return;
    const servers = serversOf();
    delete servers[x.name];
    await saveServers(servers);
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await w.inv('mcp-test', { name: edit.draft.name || 'test', ...mcpConfigOf(edit.draft) }));
    } catch (e) {
      setTest({ ok: false, error: e.message });
    } finally {
      setTesting(false);
    }
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
      if (await saveServers(servers)) {
        setImportOpen(false);
        setImportText('');
        w.toast(`已导入 ${n} 个 MCP 服务，请逐个启用`, 'ok');
      }
    } catch (e) {
      setImportErr('导入失败：' + e.message);
    }
  };

  const visible = list.filter((x) => !['decrypthub_idh', 'decrypthub_adh'].includes(x.name));
  return (
    <>
      <Section
        title="自定义 MCP"
        desc="接入外部工具服务：本地 stdio 服务以当前系统用户权限运行；只接入你信任的命令。保存并启用后连接，导入的服务默认关闭。"
        actions={
          <Flex gap="2">
            <Button
              size="2"
              variant="soft"
              color="gray"
              onClick={() => {
                setImportErr('');
                setImportOpen(true);
              }}
            >
              <Icon n="download" size={16} />
              导入 JSON
            </Button>
            <Button size="2" onClick={openNew}>
              <Icon n="plus" size={16} />
              添加服务
            </Button>
          </Flex>
        }
      >
        <Card className="mcp-list" size="2" style={{ padding: 0 }}>
          {!visible.length && (
            <EmptyState
              icon="tool"
              title="还没有接入 MCP 服务"
              description="支持 Claude Desktop / Cursor 的 mcpServers 配置，可直接粘贴导入。"
            />
          )}
          {visible.map((x) => {
            const [label, tone] = MCP_STATE[x.state] || ['未知', 'off'];
            const expanded = openTools === x.name;
            const cfg = x.config || {};
            return (
              <div className={'mcp-row' + (x.enabled ? '' : ' is-off')} key={x.name}>
                <div className="mcp-main">
                  <div className="mcp-title">
                    <strong>{x.name}</strong>
                    {x.version && (
                      <Badge size="1" color="gray">
                        v{x.version}
                      </Badge>
                    )}
                    <Badge size="1" variant="soft" color="gray">
                      {MCP_TRANSPORT.find((t) => t[0] === x.transport)?.[1] || x.transport}
                    </Badge>
                    <span className={'mcp-state ' + tone}>
                      {label}
                      {x.state === 'ready' ? ` · ${x.toolCount} 个工具` : ''}
                    </span>
                  </div>
                  {x.state === 'error' ? (
                    <div className="mcp-error" title={x.error}>
                      {x.error}
                    </div>
                  ) : x.state === 'ready' ? (
                    <button
                      type="button"
                      className="mcp-tools-toggle"
                      onClick={() => setOpenTools(expanded ? null : x.name)}
                    >
                      {expanded ? '收起工具' : `查看 ${x.toolCount} 个工具`}
                      <Icon n={expanded ? 'chevup' : 'chevdown'} size={12} />
                    </button>
                  ) : (
                    <div className="mcp-hint" title={x.transport === 'stdio' ? cfg.command : cfg.url}>
                      {x.transport === 'stdio' ? [cfg.command, ...(cfg.args || [])].join(' ') : cfg.url}
                    </div>
                  )}
                  {expanded && (
                    <div className="mcp-tools">
                      {x.tools.map((t) => (
                        <div key={t.name} className="mcp-tool">
                          <span className="mono">{t.name}</span>
                          <span title={t.description}>{t.description}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mcp-actions">
                  <Switch
                    size="1"
                    aria-label={'启用 MCP ' + x.name}
                    checked={x.enabled}
                    disabled={busy[x.name] === 'save'}
                    onCheckedChange={(v) => toggle(x, v)}
                  />
                  <ActionIcon
                    icon="reload"
                    onClick={() => restart(x)}
                    title="重新连接"
                    disabled={busy[x.name] === 'restart' || x.state === 'connecting'}
                  />
                  <ActionIcon icon="edit" onClick={() => openEdit(x)} title="编辑" />
                  <ActionIcon
                    icon="trash"
                    variant="soft"
                    color="red"
                    onClick={() => remove(x)}
                    title="删除"
                  />
                </div>
              </div>
            );
          })}
        </Card>
      </Section>

      {edit && (
        <Dialog.Root
          open
          onOpenChange={(v) => {
            if (!v) setEdit(null);
          }}
        >
          <Dialog.Content maxWidth="660px">
            <Dialog.Title>{edit.cfgName ? '编辑 MCP 服务' : '添加 MCP 服务'}</Dialog.Title>
            <Dialog.Description size="2" color="gray">
              本地进程用命令加参数启动；HTTP / SSE 填服务地址。工具名会自动加「服务名__」前缀。
            </Dialog.Description>
            <Flex gap="3" mt="4" wrap="wrap" align="end">
              <Box flexGrow="1" style={{ minWidth: 220 }}>
                <Text as="div" size="1" color="gray" mb="1">
                  名称
                </Text>
                <TextField.Root
                  value={edit.draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="filesystem"
                />
              </Box>
              <Box>
                <Text as="div" size="1" color="gray" mb="1">
                  传输
                </Text>
                <SegmentedControl.Root
                  value={edit.draft.transport}
                  onValueChange={(v) => {
                    patch({ transport: v });
                    setTest(null);
                  }}
                >
                  {MCP_TRANSPORT.map(([k, l]) => (
                    <SegmentedControl.Item key={k} value={k}>
                      {l}
                    </SegmentedControl.Item>
                  ))}
                </SegmentedControl.Root>
              </Box>
            </Flex>
            {edit.draft.transport === 'stdio' ? (
              <>
                <Box mt="3">
                  <Text as="div" size="1" color="gray" mb="1">
                    命令
                  </Text>
                  <TextField.Root
                    value={edit.draft.command}
                    onChange={(e) => patch({ command: e.target.value })}
                    placeholder="npx"
                  />
                </Box>
                <Box mt="3">
                  <Text as="div" size="1" color="gray" mb="1">
                    参数（每行一个）
                  </Text>
                  <TextArea
                    rows={4}
                    className="mono"
                    value={edit.draft.argsText}
                    onChange={(e) => patch({ argsText: e.target.value })}
                    placeholder={'-y\n@modelcontextprotocol/server-filesystem\nC:\\data'}
                  />
                </Box>
                <Box mt="3">
                  <Text as="div" size="1" color="gray" mb="1">
                    环境变量（KEY=VALUE，每行一个）
                  </Text>
                  <TextArea
                    rows={3}
                    className="mono"
                    value={edit.draft.envText}
                    onChange={(e) => patch({ envText: e.target.value })}
                    placeholder="GITHUB_TOKEN=..."
                  />
                </Box>
                <Box mt="3">
                  <Text as="div" size="1" color="gray" mb="1">
                    工作目录（可选）
                  </Text>
                  <TextField.Root
                    value={edit.draft.cwd}
                    onChange={(e) => patch({ cwd: e.target.value })}
                    placeholder="默认使用应用数据目录下的 mcp/"
                  />
                </Box>
              </>
            ) : (
              <>
                <Box mt="3">
                  <Text as="div" size="1" color="gray" mb="1">
                    服务地址
                  </Text>
                  <TextField.Root
                    value={edit.draft.url}
                    onChange={(e) => patch({ url: e.target.value })}
                    placeholder="https://example.com/mcp"
                  />
                </Box>
                <Box mt="3">
                  <Text as="div" size="1" color="gray" mb="1">
                    请求头（KEY: VALUE，每行一个）
                  </Text>
                  <TextArea
                    rows={3}
                    className="mono"
                    value={edit.draft.headersText}
                    onChange={(e) => patch({ headersText: e.target.value })}
                    placeholder="Authorization: Bearer ..."
                  />
                </Box>
              </>
            )}
            {test && (
              <div className={'mcp-test ' + (test.ok ? 'ok' : 'bad')}>
                <Text size="2" weight="medium">
                  {test.ok ? `连接成功 · ${test.tools.length} 个工具` : '连接失败：' + test.error}
                </Text>
                {test.ok && test.tools.length > 0 && (
                  <div className="mcp-test-tools">{test.tools.map((t) => t.name).join('、')}</div>
                )}
              </div>
            )}
            <Flex align="center" gap="2" mt="4">
              <Text size="1" as="label">
                <Flex align="center" gap="1">
                  <Switch
                    size="1"
                    checked={edit.draft.enabled}
                    onCheckedChange={(v) => patch({ enabled: v })}
                  />
                  启用
                </Flex>
              </Text>
              <Button size="2" variant="soft" color="gray" onClick={runTest} loading={testing}>
                <Icon n="bolt" size={16} />
                启动并测试
              </Button>
              <Box flexGrow="1" />
              <Button size="2" variant="soft" color="gray" onClick={() => setEdit(null)}>
                取消
              </Button>
              <Button size="2" onClick={commit}>
                <Icon n="check" size={16} />
                保存
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      )}

      {importOpen && (
        <Dialog.Root open onOpenChange={setImportOpen}>
          <Dialog.Content maxWidth="620px">
            <Dialog.Title>导入 MCP 配置</Dialog.Title>
            <Dialog.Description size="2" color="gray">
              粘贴 Claude Desktop / Cursor 的 mcpServers JSON；同名服务会被覆盖。
            </Dialog.Description>
            <TextArea
              mt="3"
              rows={9}
              className="mono"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={
                '{\n  "mcpServers": {\n    "filesystem": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\data"]\n    }\n  }\n}'
              }
            />
            {importErr && (
              <Text as="div" size="1" color="red" mt="2">
                {importErr}
              </Text>
            )}
            <Flex justify="end" gap="2" mt="4">
              <Button size="2" variant="soft" color="gray" onClick={() => setImportOpen(false)}>
                取消
              </Button>
              <Button size="2" onClick={doImport} disabled={!importText.trim()}>
                <Icon n="download" size={16} />
                导入
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>
      )}
    </>
  );
}
