// Shared primitives use the existing Radix system and one icon family.
import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme, Box, Flex, Text, Button as RadixButton, IconButton as RadixIconButton, TextArea, Select, Dialog, Tooltip } from '@radix-ui/themes';
import { PlayIcon, StopIcon, ArrowLeftIcon, ReloadIcon, ArrowRightIcon, GearIcon, SunIcon, MoonIcon, TrashIcon, ClockIcon, MagicWandIcon, GlobeIcon, CodeIcon, ActivityLogIcon, FileIcon, MixerHorizontalIcon, ArrowUpIcon, Cross2Icon, CheckIcon, DownloadIcon, FileTextIcon, InfoCircledIcon, ResetIcon, MinusIcon, SquareIcon, CopyIcon, PlusIcon, DotsHorizontalIcon, ChatBubbleIcon, ReaderIcon, DrawingPinIcon, LockClosedIcon, MagnifyingGlassIcon, StackIcon, ChevronUpIcon, ChevronDownIcon, ChevronRightIcon, DotFilledIcon, ViewVerticalIcon, DashboardIcon, TargetIcon, DesktopIcon, ExternalLinkIcon, LightningBoltIcon, Pencil1Icon, MobileIcon } from '@radix-ui/react-icons';
import { renderMd, highlightHtml } from './md.js';
import { themeConfig } from './theme.js';

function FolderGlyph(props) { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" {...props}><path d="M1.75 5.25V3.5c0-.7.55-1.25 1.25-1.25h3l1.5 1.5H13c.7 0 1.25.55 1.25 1.25v7.5c0 .7-.55 1.25-1.25 1.25H3c-.7 0-1.25-.55-1.25-1.25V5.25h12.5" /></svg>; }
const ICONS = {
  play: PlayIcon, stop: StopIcon, back: ArrowLeftIcon, reload: ReloadIcon,
  go: ArrowRightIcon, settings: GearIcon, sun: SunIcon, moon: MoonIcon,
  trash: TrashIcon, clock: ClockIcon, sparkles: MagicWandIcon, globe: GlobeIcon,
  code: CodeIcon, network: ActivityLogIcon, file: FileIcon, terminal: CodeIcon,
  tool: MixerHorizontalIcon, send: ArrowUpIcon, x: Cross2Icon, check: CheckIcon,
  download: DownloadIcon, report: FileTextIcon, info: InfoCircledIcon, broom: ResetIcon,
  minus: MinusIcon, square: SquareIcon, restore: CopyIcon, plus: PlusIcon,
  more: DotsHorizontalIcon, chat: ChatBubbleIcon, copy: CopyIcon, folder: FolderGlyph,
  flag: DrawingPinIcon, key: LockClosedIcon, search: MagnifyingGlassIcon, layers: StackIcon,
  chevup: ChevronUpIcon, chevdown: ChevronDownIcon, chevright: ChevronRightIcon,
  dot: DotFilledIcon, sidebar: ViewVerticalIcon, dashboard: DashboardIcon,
  target: TargetIcon, desktop: DesktopIcon, external: ExternalLinkIcon, bolt: LightningBoltIcon, edit: Pencil1Icon,
  pin: DrawingPinIcon, mobile: MobileIcon,
};

export function Icon({ n, size = 16, className }) {
  const Glyph = ICONS[n] || DotFilledIcon;
  return <Glyph className={className} width={size} height={size} aria-hidden="true" />;
}

// Secondary actions keep Radix geometry and interactive states, with a quiet rest state.
export const Button = forwardRef(function Button({ variant = 'solid', color, className = '', ...props }, ref) {
  const quiet = variant === 'soft' && color === 'gray';
  return <RadixButton {...props} ref={ref} variant={variant} color={color} className={(quiet ? 'quiet-control ' : '') + className} />;
});

// One geometry for every standalone icon action, including Radix menu triggers.
export const ActionIcon = forwardRef(function ActionIcon({ icon, title, className = '', variant = 'soft', color, size = '2', ...props }, ref) {
  return <Tooltip content={title}>
    <RadixIconButton {...props} ref={ref} size={size} variant={variant} color={color || (variant === 'solid' ? undefined : 'gray')}
      className={'action-icon ' + (variant === 'solid' ? '' : 'quiet-control ') + className} data-compact={size === '1' ? '' : undefined} aria-label={props['aria-label'] || title}>
      <Icon n={icon} size={size === '1' ? 14 : 18} />
    </RadixIconButton>
  </Tooltip>;
});

export function NavButton({ active, className = '', children, ...props }) {
  return <Button {...props} size="2" m="0" variant="soft" color={active ? 'tomato' : 'gray'}
    className={'nav-button ' + className} aria-current={active ? 'page' : undefined}>{children}</Button>;
}

export function LogoMark({ size = 26, className = 'logo' }) {
  return <img className={className} src="./logo.svg" width={size} height={size} alt="" draggable={false} />;
}

export function EmptyState({ icon = 'folder', title, description, children, compact = false }) {
  return <div className={'empty-state' + (compact ? ' compact' : '')}>
    <div className="empty-icon"><Icon n={icon} size={24} /></div>
    <h3>{title}</h3>
    {description && <p>{description}</p>}
    {children}
  </div>;
}

export function Markdown({ text }) {
  const ref = useRef();
  useEffect(() => { if (ref.current) highlightHtml(ref.current); }, [text]);
  return <div className="md" ref={ref} dangerouslySetInnerHTML={{ __html: renderMd(text) }} />;
}

export function Dropdown({ value, options = [], onChange, placeholder = '选择', title, label, width }) {
  const groups = options.map(o => (o.items ? { group: o.group, items: o.items } : { items: [o] }));
  const itemContent = it => it.icon ? <Flex align="center" gap="1"><Icon n={it.icon} size={14} />{it.label}</Flex> : it.label;
  return <Box title={title} style={{ minWidth: width || 140 }}>
    <Select.Root size="2" value={value || undefined} onValueChange={onChange}>
      <Select.Trigger className="quiet-control" placeholder={placeholder} aria-label={label} variant="soft" color="gray" style={{ width: '100%' }} />
      <Select.Content position="popper">
        {groups.map((g, i) => g.group
          ? <Select.Group key={i}><Select.Label>{g.group}</Select.Label>{g.items.map(it => <Select.Item key={it.value} value={it.value}>{itemContent(it)}</Select.Item>)}</Select.Group>
          : g.items.map(it => <Select.Item key={it.value} value={it.value}>{itemContent(it)}</Select.Item>))}
      </Select.Content>
    </Select.Root>
  </Box>;
}

// 弹层渲染到 body 会离开 <Theme> 的变量作用域，这里再包一层
const themeProps = () => ({ ...themeConfig, appearance: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark' });

function mountPromise(render) {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = v => { root.unmount(); host.remove(); resolve(v); };
    // Render as a component so promise dialogs may use React hooks.
    function PromiseDialog() { return <Theme {...themeProps()}>{render(done)}</Theme>; }
    root.render(<PromiseDialog />);
  });
}

export function askConfirm(message, { ok = '确定', danger = false, always = null } = {}) {
  return mountPromise(done => (
    <Dialog.Root open onOpenChange={o => { if (!o) done(false); }}>
      <Dialog.Content maxWidth="460px">
        <Dialog.Title className="sr-only">确认操作</Dialog.Title>
        <Dialog.Description className="sr-only">请确认是否继续执行此操作。</Dialog.Description>
        <Text size="2" style={{ display: 'block', lineHeight: 1.75 }}>{message}</Text>
        <Flex justify="end" gap="2" mt="4">
          <Button size="2" variant="soft" color="gray" onClick={() => done(false)}>取消</Button>
          {always && <Button size="2" variant="soft" color="gray" onClick={() => done('always')}>{always}</Button>}
          <Button size="2" color={danger ? 'red' : undefined} onClick={() => done(true)}>{ok}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  ));
}

export function askQuestion({ question, detail, options = [], kind, todos = [] } = {}) {
  return mountPromise(done => {
    const [text, setText] = useState('');
    const submit = () => done(text.trim());
    return <Dialog.Root open onOpenChange={o => { if (!o) done(''); }}>
      <Dialog.Content maxWidth="540px">
        <Dialog.Title size="3">{kind === 'plan' ? '确认计划' : 'AI 想问你'}</Dialog.Title>
        <Dialog.Description className="sr-only">选择建议选项或输入你的回答。</Dialog.Description>
        <Text size="2" style={{ display: 'block', marginTop: 8, lineHeight: 1.75 }}>{question}</Text>
        {detail && <Text size="1" color="gray" style={{ display: 'block', marginTop: 6, lineHeight: 1.7 }}>{detail}</Text>}
        {kind === 'plan' && todos.length > 0 && <Box mt="3">
          {todos.map(t => <Flex key={t.id} gap="2" align="baseline">
            <Text size="1" color={t.status === 'in_progress' ? 'tomato' : 'gray'}>{t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '●' : '○'}</Text>
            <Text size="1">{t.content}</Text>
          </Flex>)}
        </Box>}
        {options.length > 0 && <Flex wrap="wrap" gap="2" mt="3">{options.map(o => <Button key={o} size="2" variant="soft" color="gray" onClick={() => done(o)}>{o}</Button>)}</Flex>}
        <Box mt="3">
          <TextArea size="2" autoFocus rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="输入回答（Enter 提交 · Shift+Enter 换行 · Esc 跳过）"
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); done(''); } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        </Box>
        <Flex justify="end" gap="2" mt="4">
          <Button size="2" variant="soft" color="gray" onClick={() => done('')}>跳过</Button>
          <Button size="2" disabled={!text.trim()} onClick={submit}>回答</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>;
  });
}
