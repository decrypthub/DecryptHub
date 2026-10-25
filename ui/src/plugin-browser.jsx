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
export function BrowserSettings({ s, up }) {
  const w = useWorkbench();
  const [kernel, setKernel] = useState(null),
    [dl, setDl] = useState(null),
    [err, setErr] = useState('');
  const [repo, setRepo] = useState('CloakHQ/cloakbrowser'),
    [tag, setTag] = useState(''),
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
  const k = s.kernel || 'system',
    info = kernel?.[k],
    pct = dl?.total ? Math.round((dl.got / dl.total) * 100) : null;
  async function download() {
    setErr('');
    setDl({ phase: 'metadata', got: 0, total: 0 });
    const r = await window.api
      .invoke(k === 'bundled' ? 'download-chrome' : 'download-kernel', {
        repository: k === 'cloak' ? 'CloakHQ/cloakbrowser' : repo,
        tag: tag.trim(),
        asset: asset.trim(),
      })
      .catch((e) => ({ ok: false, error: e.message }));
    setDl(null);
    load();
    if (r.ok) {
      up('kernel', r.kind || 'bundled');
      up('chromePath', '');
      w.toast('浏览器内核已就绪，新打开浏览器时生效', 'ok');
    } else setErr(r.error);
  }
  async function probe() {
    setErr('');
    setDl({ phase: 'probe' });
    const r = await window.api
      .invoke('probe-kernel', { kernel: k, chromePath: s.chromePath })
      .catch((e) => ({ ok: false, error: e.message }));
    setDl(null);
    if (r.ok) w.toast('浏览器启动与画面检查通过', 'ok');
    else setErr(r.error);
  }
  async function repair() {
    setErr('');
    setDl({ phase: 'probe' });
    const r = await window.api
      .invoke('kernel-repair', { kind: k })
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
        desc="使用系统 Chrome / Edge、自定义 Chromium，或从 GitHub Release 下载。新设置在下次打开浏览器时生效。"
      >
        <SegmentedControl.Root
          size="2"
          value={k}
          onValueChange={(v) => {
            up('kernel', v);
            setErr('');
          }}
        >
          <SegmentedControl.Item value="system">系统</SegmentedControl.Item>
          <SegmentedControl.Item value="custom">自定义</SegmentedControl.Item>
          <SegmentedControl.Item value="cloak">CloakBrowser</SegmentedControl.Item>
          <SegmentedControl.Item value="github">GitHub</SegmentedControl.Item>
          <SegmentedControl.Item value="bundled">Chromium</SegmentedControl.Item>
        </SegmentedControl.Root>
        {k === 'system' && (
          <Text as="p" size="1" color={kernel?.system ? 'gray' : 'amber'}>
            {kernel?.system?.path || '没有找到系统 Chrome / Edge'}
          </Text>
        )}
        {k === 'custom' && (
          <Box mt="3">
            <Text as="div" size="1" color="gray" mb="1">
              浏览器可执行文件的完整路径
            </Text>
            <TextField.Root
              size="2"
              value={s.chromePath || ''}
              onChange={(e) => up('chromePath', e.target.value)}
              placeholder="C:\Program Files\Chromium\chrome.exe"
              spellCheck={false}
            />
            <Text as="p" size="1" color="gray">
              支持兼容 Chrome DevTools Protocol 的 Chromium 内核。
            </Text>
          </Box>
        )}
        {['cloak', 'github', 'bundled'].includes(k) && (
          <Box mt="3">
            {k === 'cloak' && (
              <Text as="p" size="1" color="gray">
                来源：CloakHQ/cloakbrowser · 官方 Release，验证发布签名与 SHA-256。
              </Text>
            )}
            {k === 'github' && (
              <Flex direction="column" gap="2">
                <TextField.Root
                  aria-label="GitHub 仓库"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="owner/repo"
                />
                <TextField.Root
                  aria-label="Release 标签"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="版本标签（留空使用最新 Release）"
                />
                <TextField.Root
                  aria-label="Release 文件名"
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                  placeholder="压缩包文件名（留空按系统匹配）"
                />
              </Flex>
            )}
            <Text as="p" size="1" color={info ? 'green' : 'gray'}>
              {info ? `已安装 ${info.version || ''} · ${info.verified || 'Chromium'}` : '尚未安装'}
            </Text>
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
                {info ? '下载更新' : '下载内核'}
              </Button>
            )}
          </Box>
        )}
        {kernel?.hostIntegrity?.normal === false && (
          <Text as="p" size="1" color="red">
            当前程序受 Windows 低完整性限制。请关闭旧窗口，从普通终端重新启动桌面程序。
          </Text>
        )}
        <Flex mt="3" gap="2" wrap="wrap">
          <Button size="2" variant="soft" color="gray" disabled={!!dl} onClick={probe}>
            测试所选内核
          </Button>
          {info && ['cloak', 'github', 'bundled'].includes(k) && (
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
        <Row label="显示模式" desc="无头模式不弹窗口，只能看画面串流">
          <SegmentedControl.Root
            size="2"
            value={s.headless ? 'headless' : 'head'}
            onValueChange={(v) => up('headless', v === 'headless')}
          >
            <SegmentedControl.Item value="head">有头（推荐）</SegmentedControl.Item>
            <SegmentedControl.Item value="headless">无头</SegmentedControl.Item>
          </SegmentedControl.Root>
        </Row>
        {!s.headless && (
          <Row label="画面嵌入" desc="原生嵌入会把真实 Chrome 窗口贴进右侧面板；失败自动回落画面串流">
            <SegmentedControl.Root
              size="2"
              value={s.embedMode || 'auto'}
              onValueChange={(v) => up('embedMode', v)}
            >
              <SegmentedControl.Item value="auto">自动</SegmentedControl.Item>
              <SegmentedControl.Item value="embedded">原生嵌入</SegmentedControl.Item>
              <SegmentedControl.Item value="screencast">画面串流</SegmentedControl.Item>
            </SegmentedControl.Root>
          </Row>
        )}
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
