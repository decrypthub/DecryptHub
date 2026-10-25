import React, { useEffect, useRef, useState } from 'react';
import { Badge, Box, Flex, Progress, Switch, Text, TextField } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, Icon } from './kit.jsx';
import { BrowserSettings } from './plugin-browser.jsx';
import { McpServices } from './plugin-mcp.jsx';

const STATES = {
  'not-installed': '未安装',
  disabled: '已停用',
  ready: '就绪 · 按需启动',
  running: '运行中',
  'needs-runtime': '需要 Python 3.10+',
  'needs-configuration': '待配置连接',
  'needs-approval': '待确认配置',
  connecting: '连接中',
  error: '连接失败',
  idle: '未连接',
};
const PHASES = {
  checking: '检查发布版本',
  downloading: '下载中',
  verifying: '校验安装包',
  installing: '安装中',
  cancelling: '正在取消',
};
const active = (operation) => !!PHASES[operation?.phase];
const size = (bytes) =>
  bytes > 1024 ** 2 ? (bytes / 1024 ** 2).toFixed(1) + ' MB' : Math.ceil((bytes || 0) / 1024) + ' KB';
export function PluginCenter() {
  const w = useWorkbench(),
    [data, setData] = useState(null),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(''),
    [opened, setOpened] = useState(null),
    [busy, setBusy] = useState({});
  const alive = useRef(true),
    pending = useRef(new Set());
  const receive = (value) => {
    if (!alive.current) return;
    setData(value);
    for (const plugin of value.official || [])
      if (
        pending.current.has(plugin.id) &&
        ['installed', 'error', 'cancelled'].includes(plugin.operation?.phase)
      ) {
        pending.current.delete(plugin.id);
        if (plugin.operation.phase === 'installed') w.toast(plugin.shortName + ' 已安装', 'ok');
      }
  };
  const refresh = async (force = false) => {
    setRefreshing(true);
    setError('');
    try {
      receive(await w.api.invoke('plugins-refresh', { force }));
    } catch (e) {
      if (alive.current) setError(e.message);
    } finally {
      if (alive.current) setRefreshing(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    w.api
      .invoke('plugins-list')
      .then(receive)
      .catch((e) => {
        if (alive.current) setError(e.message);
      })
      .finally(() => {
        if (alive.current) {
          setLoading(false);
          refresh();
        }
      });
    const off = w.api.on('plugins-status', receive),
      offMcp = w.api.on('mcp-status', () =>
        w.api
          .invoke('plugins-list')
          .then(receive)
          .catch(() => {}),
      );
    const timer = setInterval(
      () =>
        w.api
          .invoke('plugins-list')
          .then(receive)
          .catch(() => {}),
      10000,
    );
    return () => {
      alive.current = false;
      off();
      offMcp();
      clearInterval(timer);
    };
  }, []);
  async function act(id, channel, args = {}) {
    setBusy((value) => ({ ...value, [id]: true }));
    setError('');
    try {
      if (channel === 'plugin-install') pending.current.add(id);
      receive(await w.api.invoke(channel, { id, ...args }));
    } catch (e) {
      pending.current.delete(id);
      setError(e.message);
    } finally {
      if (alive.current) setBusy((value) => ({ ...value, [id]: false }));
    }
  }
  return (
    <main className="plugins-page">
      <div className="plugins-intro">
        <div>
          <h1>插件</h1>
          <Text as="p" size="2" color="gray">
            按需安装平台能力，或接入你自己的 MCP 服务。
          </Text>
        </div>
        <Button size="2" variant="soft" color="gray" loading={refreshing} onClick={() => refresh(true)}>
          <Icon n="reload" size={15} />
          检查更新
        </Button>
      </div>
      {error && (
        <div className="plugin-page-error" role="alert">
          {error}
        </div>
      )}
      <section className="official-plugins" aria-label="官方插件">
        <div className="plugin-section-heading">
          <h2>官方插件</h2>
          <Text size="1" color="gray">
            由 DecryptHub 维护
          </Text>
        </div>
        {loading && !data ? (
          <div className="plugin-loading" role="status">
            正在读取插件状态…
          </div>
        ) : (
          (data?.official || []).map((plugin) => {
            const operation = plugin.operation,
              working = active(operation),
              installed = plugin.installed,
              expanded = opened === plugin.id;
            const tone =
              plugin.state === 'error'
                ? 'red'
                : ['ready', 'running'].includes(plugin.state)
                  ? 'green'
                  : 'gray';
            return (
              <article key={plugin.id} className="official-plugin" data-plugin-id={plugin.id}>
                <div className="plugin-row">
                  <div className="plugin-symbol">
                    <Icon n={plugin.icon} size={24} />
                  </div>
                  <div className="plugin-summary">
                    <div className="plugin-name">
                      <h3>{plugin.name}</h3>
                      <Badge size="1" color={tone}>
                        {plugin.id !== 'wdh' && plugin.state === 'ready'
                          ? '已连接'
                          : STATES[plugin.state] || plugin.state}
                      </Badge>
                      {plugin.latest?.prerelease && (
                        <Text size="1" color="gray">
                          预览版
                        </Text>
                      )}
                    </div>
                    <Text as="p" size="2" color="gray">
                      {plugin.description}
                    </Text>
                    <div className="plugin-version">
                      <span>
                        {installed
                          ? (plugin.runtime === 'python' ? '网关已安装 ' : '已安装 ') + plugin.version
                          : '尚未安装'}
                      </span>
                      <span>
                        {plugin.latest
                          ? (plugin.runtime === 'python' ? '最新网关 ' : '最新 ') + plugin.latest.version
                          : plugin.catalogError
                            ? '版本检查失败'
                            : refreshing
                              ? '检查版本中…'
                              : '暂无兼容安装包'}
                      </span>
                      {plugin.serverVersion && <span>MCP {plugin.serverVersion}</span>}
                      {plugin.toolCount > 0 && <span>{plugin.toolCount} 个工具</span>}
                    </div>
                  </div>
                  <div className="plugin-actions">
                    {installed && (
                      <Switch
                        size="1"
                        aria-label={'启用 ' + plugin.shortName}
                        checked={plugin.enabled}
                        disabled={working || busy[plugin.id]}
                        onCheckedChange={(enabled) => {
                          if (enabled && plugin.id !== 'wdh' && !plugin.endpoint) {
                            setOpened(plugin.id);
                            return;
                          }
                          act(plugin.id, 'plugin-toggle', { enabled });
                        }}
                      />
                    )}
                    {!installed || plugin.updateAvailable ? (
                      <Button
                        size="2"
                        disabled={!plugin.latest || working || busy[plugin.id]}
                        onClick={() => act(plugin.id, 'plugin-install')}
                        aria-label={(installed ? '更新 ' : '安装 ') + plugin.shortName}
                      >
                        {installed ? '更新' : '下载并安装'}
                      </Button>
                    ) : null}
                    <Button
                      size="2"
                      variant="soft"
                      color="gray"
                      aria-expanded={expanded}
                      aria-controls={'plugin-detail-' + plugin.id}
                      onClick={() => setOpened(expanded ? null : plugin.id)}
                    >
                      {expanded ? '收起' : '配置'}
                      <Icon n={expanded ? 'chevup' : 'chevdown'} size={12} />
                    </Button>
                  </div>
                </div>
                {working && (
                  <div className="plugin-operation" role="status">
                    <Flex align="center" gap="3">
                      <Text size="1">
                        {PHASES[operation.phase]}
                        {operation.phase === 'verifying' && operation.totalFiles
                          ? ' · ' + operation.doneFiles + ' / ' + operation.totalFiles + ' 文件'
                          : ''}
                        {operation.total ? ' · ' + size(operation.got) + ' / ' + size(operation.total) : ''}
                      </Text>
                      <Box flexGrow="1" />
                      <Button
                        size="1"
                        variant="ghost"
                        color="gray"
                        disabled={operation.phase === 'installing' || operation.phase === 'cancelling'}
                        onClick={() => act(plugin.id, 'plugin-cancel')}
                        aria-label={'取消安装 ' + plugin.shortName}
                      >
                        取消
                      </Button>
                    </Flex>
                    <Progress
                      size="1"
                      value={
                        operation.total ? Math.round((operation.got / operation.total) * 100) : undefined
                      }
                    />
                  </div>
                )}
                {operation?.phase === 'error' && (
                  <div className="plugin-inline-error" role="alert">
                    {operation.error}
                  </div>
                )}
                {plugin.catalogError && (
                  <div className="plugin-inline-note">{plugin.catalogError} 已安装的插件可继续使用。</div>
                )}
                {expanded && (
                  <div className="plugin-detail" id={'plugin-detail-' + plugin.id}>
                    <Text as="p" size="2" color="gray">
                      {plugin.note}
                    </Text>
                    <div className="plugin-source">
                      <Text size="1" color="gray">
                        来源
                      </Text>
                      <Button
                        size="1"
                        variant="ghost"
                        color="gray"
                        title="复制项目地址"
                        onClick={() =>
                          navigator.clipboard
                            .writeText('https://github.com/' + plugin.repository)
                            .then(() => w.toast('项目地址已复制', 'ok'))
                        }
                      >
                        {plugin.repository}
                        <Icon n="copy" size={12} />
                      </Button>
                    </div>
                    {plugin.id === 'wdh' ? (
                      installed ? (
                        plugin.enabled ? (
                          <WdhPreferences />
                        ) : (
                          <Text as="p" size="2">
                            启用 WDH 后可管理浏览器内核。
                          </Text>
                        )
                      ) : (
                        <Text as="p" size="2">
                          安装后即可配置浏览器内核。
                        </Text>
                      )
                    ) : (
                      <DeviceConnection
                        plugin={plugin}
                        busy={busy[plugin.id]}
                        onConfigure={(endpoint) => act(plugin.id, 'plugin-configure', { endpoint })}
                        onReconnect={() => act(plugin.id, 'plugin-reconnect')}
                      />
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
      <section className="custom-plugins" aria-label="自定义 MCP 服务">
        <McpServices />
      </section>
    </main>
  );
}
function DeviceConnection({ plugin, busy, onConfigure, onReconnect }) {
  const w = useWorkbench();
  const [endpoint, setEndpoint] = useState(plugin.endpoint || '');
  useEffect(() => setEndpoint(plugin.endpoint || ''), [plugin.endpoint]);
  return (
    <div className="plugin-connection">
      <div className="plugin-source">
        <Text size="1" color="gray">
          设备端项目
        </Text>
        <Button
          size="1"
          variant="ghost"
          color="gray"
          title="复制设备端项目地址"
          onClick={() =>
            navigator.clipboard
              .writeText('https://github.com/' + plugin.deviceRepository)
              .then(() => w.toast('设备端项目地址已复制', 'ok'))
          }
        >
          {plugin.deviceRepository}
          <Icon n="copy" size={12} />
        </Button>
      </div>
      <div className="plugin-runtime">
        <Text size="1" color={plugin.runtimeInfo?.available ? 'gray' : 'amber'}>
          {plugin.runtimeInfo?.available
            ? plugin.runtimeInfo.version
            : plugin.runtimeInfo?.error || '正在检查 Python 运行环境…'}
        </Text>
      </div>
      <label htmlFor={'plugin-endpoint-' + plugin.id}>设备服务地址</label>
      <div className="plugin-endpoint-row">
        <TextField.Root
          className="plugin-endpoint-input"
          id={'plugin-endpoint-' + plugin.id}
          aria-label={plugin.shortName + ' 服务地址'}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder={plugin.id === 'idh' ? 'http://设备 IP:8088' : 'http://127.0.0.1:8088'}
          disabled={!plugin.installed}
        />
        <Button
          size="2"
          disabled={!plugin.installed || !plugin.runtimeInfo?.available || !endpoint.trim() || busy}
          loading={busy}
          onClick={() => onConfigure(endpoint)}
        >
          保存并连接
        </Button>
        {plugin.endpoint && (
          <Button size="2" variant="soft" color="gray" disabled={busy} onClick={onReconnect}>
            重新连接
          </Button>
        )}
      </div>
      <Text as="p" size="1" color="gray">
        设备插件需事先部署；只连接你拥有的设备或受信任的局域网服务。
      </Text>
      {plugin.error && (
        <div className="plugin-inline-error" role="alert">
          {plugin.error}
        </div>
      )}
    </div>
  );
}
function WdhPreferences() {
  const w = useWorkbench(),
    [settings, setSettings] = useState(w.settings),
    [saving, setSaving] = useState(false);
  useEffect(() => setSettings(w.settings), [w.settings]);
  const up = (key, value) => setSettings((s) => ({ ...s, [key]: value })),
    dirty = JSON.stringify(settings) !== JSON.stringify(w.settings);
  return (
    <>
      <BrowserSettings s={settings} up={up} />
      {dirty && (
        <Flex justify="end" gap="2">
          <Button size="2" variant="soft" color="gray" onClick={() => setSettings(w.settings)}>
            还原
          </Button>
          <Button
            size="2"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await w.saveSettings(settings);
              } finally {
                setSaving(false);
              }
            }}
          >
            保存浏览器设置
          </Button>
        </Flex>
      )}
    </>
  );
}
