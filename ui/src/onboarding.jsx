// 首次启动引导：记录用户的逆向领域、水平和模型渠道，供 Agent 调整解释深度。
import React, { useState } from 'react';
import { Dialog, Flex, Text, TextField, Button, Badge, SegmentedControl } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Icon, LogoMark } from './kit.jsx';

const DOMAINS = [
  { id: 'web', label: 'Web 安全', desc: '前端、接口、JS 混淆与浏览器调试' },
  { id: 'android', label: 'Android 逆向', desc: 'APK、Native、加固与协议分析' },
  { id: 'ios', label: 'iOS 逆向', desc: 'IPA、Mach-O、越狱与巨魔环境' },
];
const LEVELS = [
  { id: 'novice', label: '小白', desc: '刚接触，需要从概念讲起' },
  { id: 'beginner', label: '入门', desc: '能跟着步骤完成分析' },
  { id: 'regular', label: '普通', desc: '能独立完成常见任务' },
  { id: 'advanced', label: '高级', desc: '熟悉工具链和对抗' },
  { id: 'elite', label: '精英', desc: '能定位疑难问题' },
  { id: 'master', label: '大佬', desc: '直接讨论边界与取舍' },
];
const PROVIDERS = [
  { id: 'openai', label: 'OpenAI 兼容', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { id: 'anthropic', label: 'Claude 原生', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
];

export function OnboardingDialog() {
  const w = useWorkbench();
  const s = w.settings || {};
  const [step, setStep] = useState(0);
  const [domains, setDomains] = useState(s.onboarding?.domains || []);
  const [level, setLevel] = useState(s.onboarding?.level || '');
  const [provider, setProvider] = useState(s.provider === 'anthropic' ? 'anthropic' : 'openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showBase, setShowBase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const hasKey = !!(s.providers?.find(p => p.id === s.activeProviderId)?.hasKey || s.openai?.hasKey || s.anthropic?.hasKey);

  const toggleDomain = id => setDomains(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const canNext = step === 0 ? domains.length > 0 : step === 1 ? !!level : true;

  async function markSkipped() {
    setSaved(true);
    await w.saveSettings({ ...s, onboarding: { version: 1, skippedAt: new Date().toISOString() } }, true).catch(() => {});
    w.setFirstRun(false);
  }

  async function finish(skipKey) {
    setBusy(true); setError('');
    try {
      const profile = { version: 1, completedAt: new Date().toISOString(), domains, level };
      let providers = s.providers || [];
      let activeProviderId = s.activeProviderId;
      let activeModel = s.activeModel;
      if (!skipKey && apiKey.trim()) {
        const meta = PROVIDERS.find(p => p.id === provider);
        const entry = { id: 'p' + Math.random().toString(36).slice(2, 8), name: meta.label, type: meta.id, baseUrl: baseUrl.trim() || meta.baseUrl, models: [{ id: meta.model, name: meta.model }], apiKey: apiKey.trim() };
        providers = [...providers, entry];
        activeProviderId = entry.id; activeModel = meta.model;
      }
      setSaved(true);
      await w.saveSettings({ ...s, providers, activeProviderId, activeModel, onboarding: profile }, true);
      w.setFirstRun(false);
      if (!skipKey && !apiKey.trim() && !hasKey) w.toast('可以先浏览，配置模型后再开始对话', 'warn', 6000);
    } catch (e) { setSaved(false); setError(e.message); } finally { setBusy(false); }
  }

  return <Dialog.Root open onOpenChange={open => { if (!open && !saved) markSkipped(); }}>
    <Dialog.Content className="onboarding-dialog" maxWidth="640px">
      <div className="onboarding-head"><LogoMark size={34} /><span>设置你的分析偏好</span><Badge size="1" variant="soft" color="gray">第 {step + 1} / 3 步</Badge></div>
      {step === 0 && <>
        <Dialog.Title size="6">你主要做哪类逆向？</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">可以多选。Agent 会据此选择例子、工具和默认深度。</Dialog.Description>
        <div className="onboarding-grid">{DOMAINS.map(d => <button type="button" key={d.id} aria-pressed={domains.includes(d.id)} className={'onboarding-choice' + (domains.includes(d.id) ? ' on' : '')} onClick={() => toggleDomain(d.id)}>
          <Icon n={d.id === 'web' ? 'globe' : d.id === 'android' ? 'mobile' : 'layers'} size={20} /><strong>{d.label}</strong><small>{d.desc}</small>
        </button>)}</div>
      </>}
      {step === 1 && <>
        <Dialog.Title size="6">你的逆向水平？</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">只影响解释的深度，不影响可用功能。</Dialog.Description>
        <div className="onboarding-levels">{LEVELS.map(l => <button type="button" key={l.id} aria-pressed={level === l.id} className={'onboarding-choice' + (level === l.id ? ' on' : '')} onClick={() => setLevel(l.id)}>
          <Icon n="user" size={18} /><strong>{l.label}</strong><small>{l.desc}</small>
        </button>)}</div>
      </>}
      {step === 2 && <>
        <Dialog.Title size="6">连接模型</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">粘贴 API Key 即可开始；也可以稍后在设置里配置。</Dialog.Description>
        <SegmentedControl.Root value={provider} onValueChange={setProvider} size="2" className="onboarding-provider">
          {PROVIDERS.map(p => <SegmentedControl.Item key={p.id} value={p.id}>{p.label}</SegmentedControl.Item>)}
        </SegmentedControl.Root>
        <div className="onboarding-form">
          <TextField.Root type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={hasKey ? '已配置模型，留空则保持不变' : 'API Key'} aria-label="模型 API Key" autoComplete="off" spellCheck={false} />
          {showBase ? <TextField.Root value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={PROVIDERS.find(p => p.id === provider)?.baseUrl} aria-label="模型接口地址" spellCheck={false} />
            : <button type="button" className="onboarding-link" onClick={() => setShowBase(true)}>使用自定义接口地址</button>}
          <Text as="p" size="1" color="gray">
            {provider === 'anthropic' ? 'Anthropic Console → API Keys' : 'OpenAI Platform → API keys'}；密钥只保存在本机系统密钥库。
          </Text>
        </div>
      </>}
      {error && <Text as="p" size="1" color="red" mt="3">{error}</Text>}
      <Flex justify="between" align="center" mt="5" gap="3">
        <Button variant="ghost" color="gray" onClick={markSkipped}>稍后</Button>
        <Flex gap="2">
          {step > 0 && <Button variant="soft" color="gray" onClick={() => setStep(step - 1)}>上一步</Button>}
          {step < 2 && <Button onClick={() => setStep(step + 1)} disabled={!canNext}>下一步</Button>}
          {step === 2 && <>
            <Button variant="soft" color="gray" onClick={() => finish(true)} disabled={busy}>跳过模型</Button>
            <Button onClick={() => finish(false)} disabled={busy || (!apiKey.trim() && !hasKey)}>完成</Button>
          </>}
        </Flex>
      </Flex>
    </Dialog.Content>
  </Dialog.Root>;
}
