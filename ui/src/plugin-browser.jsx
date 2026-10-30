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
// ---------- 浏览器 ----------
// 桌面版只使用 WDH 自带的 CloakBrowser 内核，其它内核选项已移除。
const KERNEL = 'cloak';
export function BrowserSettings({ s, up }) {
  const w = useWorkbench();
  const [kernel, setKernel] = useState(null),
    [dl, setDl] = useState(null),
    [err, setErr] = useState('');
  const [tag, setTag] = useState(''),
    [asset, setAsset] = useState('');
  const load = () =>
    window.api
      .invoke('kernel-info')
      .then(setKernel)
      .catch(() => setKernel({}));
  useEffect(() => {
    load();
    return window.api.on('download-progress', (p) => setDl(['done', 'error'].includes(p.phase) ? null : p));
  }, []);
  const info = kernel?.[KERNEL],
    pct = dl?.total ? Math.round((dl.got / dl.total) * 100) : null;
  async function download() {
    setErr('');
    setDl({ phase: 'metadata', got: 0, total: 0 });
    const r = await window.api
      .invoke('download-kernel', { repository: 'CloakHQ/cloakbrowser', tag: tag.trim(), asset: asset.trim() })
      .catch((e) => ({ ok: false, error: e.message }));
    setDl(null);
    load();
    if (r.ok) w.toast('CloakBrowser 已就绪，新打开浏览器时生效', 'ok');
    else setErr(r.error);
  }
  async function probe() {
    setErr('');
    setDl({ phase: 'probe' });
    const r = await window.api
      .invoke('probe-kernel', { kernel: KERNEL })
      .catch((e) => ({ ok: false, error: e.message }));
    setDl(null);
    if (r.ok) w.toast('浏览器启动与画面检查通过', 'ok');
    else setErr(r.error);
  }
  async function repair() {
    setErr('');
    setDl({ phase: 'probe' });
    const r = await window.api
      .invoke('kernel-repair', { kind: KERNEL })
      .catch((e) => ({ ok: false, error: e.message }));
    setDl(null);
    if (r.ok) {
      w.toast('内核运行权限已修复，启动检查通过', 'ok');
      load();
    } else setErr(r.error);
  }
  if (kernel?.component && !kernel.component.installed)
    return (
      <Section
        title="WebDecryptHub"
        desc="可选的浏览器分析组件。安装后可打开网页、抓取请求、调试脚本，并显示 Agent 控制状态。"
      >
        <Text as="p" size="2">
          尚未安装 WDH。当前仍可使用文件、代码与外部 MCP 服务。
        </Text>
        {kernel.component.error && (
          <Text as="p" color="amber" size="1">
            {kernel.component.error}
          </Text>
        )}
        <Button
          variant="soft"
          onClick={() =>
            navigator.clipboard
              .writeText('https://github.com/decrypthub/DecryptHub/blob/main/docs/components.md')
              .then(() => w.toast('安装说明链接已复制', 'ok'))
          }
        >
          复制安装说明链接
        </Button>
        <Text as="p" size="1" color="gray">
          首版支持经过校验的本地组件安装；GitHub 组件目录和自动更新将在后续版本接入。
        </Text>
      </Section>
    );
  return (
    <>
      <Section
        title="WebDecryptHub · 浏览器内核"
        desc="桌面版只使用 WDH 自带的 CloakBrowser，不再提供系统 Chrome / Edge、自定义 Chromium、GitHub Release 与 Chrome for Testing。"
      >
        <Box mt="3">
          <Text as="p" size="1" color="gray">
            来源：CloakHQ/cloakbrowser · 官方 Release，验证发布签名与 SHA-256。官方未提供当前平台内核时，可填写版本标签或文件名。
          </Text>
          <Text as="p" size="1" color={info ? 'green' : 'gray'}>
            {info ? `已安装 ${info.version || ''} · ${info.verified || 'Chromium'}` : '尚未安装 CloakBrowser'}
          </Text>
          <Flex direction="column" gap="2" mt="2">
            <TextField.Root
              aria-label="CloakBrowser 版本标签"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="版本标签（留空使用官方最新可用 Release）"
            />
            <TextField.Root
              aria-label="CloakBrowser 文件名"
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              placeholder="压缩包文件名（留空按系统匹配）"
            />
          </Flex>
          {dl ? (
            <>
              <Progress value={pct ?? 8} size="1" />
              <Text as="p" size="1" color="gray">
                {dl.phase === 'metadata'
                  ? '读取 Release…'
                  : dl.phase === 'probe'
                    ? '检查内核启动…'
                    : dl.phase === 'extract'
                      ? '校验完成，正在解压…'
                      : `${pct ?? ''}% · ${((dl.got || 0) / 1e6).toFixed(0)} MB`}
              </Text>
            </>
          ) : (
            <Button size="2" variant="soft" onClick={download}>
              <Icon n="download" size={16} />
              {info ? '下载更新' : '下载 CloakBrowser'}
            </Button>
          )}
        </Box>
        {kernel?.hostIntegrity?.normal === false && (
          <Text as="p" size="1" color="red">
            当前程序受 Windows 低完整性限制。请关闭旧窗口，从普通终端重新启动桌面程序。
          </Text>
        )}
        <Flex mt="3" gap="2" wrap="wrap">
          <Button size="2" variant="soft" color="gray" disabled={!!dl} onClick={probe}>
            测试 CloakBrowser
          </Button>
          {info && (
            <Button
              size="2"
              variant="soft"
              color="gray"
              disabled={!!dl || kernel?.hostIntegrity?.normal === false}
              onClick={repair}
            >
              修复已安装内核
            </Button>
          )}
        </Flex>
        {err && (
          <Text as="p" size="1" color="red" role="alert">
            {err}
          </Text>
        )}
      </Section>

      <Section title="显示">
        <Row label="主会话登录态" desc="保留：复用同一浏览器配置；每次全新：每次启动用隔离配置">
          <SegmentedControl.Root
            size="2"
            value={s.isolated ? 'iso' : 'keep'}
            onValueChange={(v) => up('isolated', v === 'iso')}
          >
            <SegmentedControl.Item value="keep">保留</SegmentedControl.Item>
            <SegmentedControl.Item value="iso">每次全新</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Row>
        <Row label="浏览器显示" desc="macOS 没有原生嵌入：可选有头窗口停靠（清晰、低延迟，窗口独立存在）或画面串流（嵌在应用内）。">
          <SegmentedControl.Root
            size="2"
            value={s.embedMode === 'docked' ? 'docked' : s.headless || s.embedMode === 'screencast' ? 'screencast' : 'auto'}
            onValueChange={(v) => { up('headless', v === 'screencast'); up('embedMode', v); }}
          >
            <SegmentedControl.Item value="auto">自动</SegmentedControl.Item>
            <SegmentedControl.Item value="docked">停靠窗口</SegmentedControl.Item>
            <SegmentedControl.Item value="screencast">画面串流</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Row>
      </Section>

      <Section title="行为">
        <Row label="代理" desc="留空表示直连">
          <TextField.Root
            size="2"
            style={{ width: 320 }}
            value={s.proxy || ''}
            onChange={(e) => up('proxy', e.target.value.trim())}
            placeholder="http://127.0.0.1:7890"
            spellCheck={false}
          />
        </Row>
      </Section>
    </>
  );
}
