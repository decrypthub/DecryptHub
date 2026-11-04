// Shared primitives use the existing Radix system and one icon family.
import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme, Box, Flex, Text, Button as RadixButton, IconButton as RadixIconButton, TextArea, Select, Dialog, Tooltip, Checkbox } from '@radix-ui/themes';
import { PlayIcon, StopIcon, ArrowLeftIcon, ReloadIcon, ArrowRightIcon, GearIcon, SunIcon, MoonIcon, TrashIcon, ClockIcon, MagicWandIcon, GlobeIcon, CodeIcon, ActivityLogIcon, FileIcon, MixerHorizontalIcon, ArrowUpIcon, Cross2Icon, CheckIcon, DownloadIcon, FileTextIcon, InfoCircledIcon, ResetIcon, MinusIcon, SquareIcon, CopyIcon, PlusIcon, DotsHorizontalIcon, ChatBubbleIcon, ReaderIcon, DrawingPinIcon, LockClosedIcon, MagnifyingGlassIcon, StackIcon, ChevronUpIcon, ChevronDownIcon, ChevronRightIcon, ChevronLeftIcon, DotFilledIcon, ViewVerticalIcon, DashboardIcon, TargetIcon, DesktopIcon, ExternalLinkIcon, LightningBoltIcon, Pencil1Icon, MobileIcon, PersonIcon } from '@radix-ui/react-icons';
import { renderMd, highlightHtml } from './md.js';
import { themeConfig } from './theme.js';
import { PauseIcon, PaperPlaneIcon, ExitIcon } from '@radix-ui/react-icons';

function FolderGlyph(props) { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" {...props}><path d="M1.75 5.25V3.5c0-.7.55-1.25 1.25-1.25h3l1.5 1.5H13c.7 0 1.25.55 1.25 1.25v7.5c0 .7-.55 1.25-1.25 1.25H3c-.7 0-1.25-.55-1.25-1.25V5.25h12.5" /></svg>; }
function SidebarLeftGlyph(props) { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M7 3v14" /></svg>; }
function SidebarRightGlyph(props) { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" {...props}><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M13 3v14" /></svg>; }
function ThumbUpGlyph(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>; }
function ThumbDownGlyph(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" /></svg>; }
// 权限三档的盾牌：同一副轮廓 + 不同的内芯，和 DSH 的 PermissionIcon 一样靠内芯区分档位，
// 而不是三个互不相干的图标。轮廓是通用盾形，不是任何产品的标识。
function PermShield(props) { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d="M8 1.85l4.9 1.8v3.45c0 4.05-3.05 5.9-4.9 6.75-1.85-.85-4.9-2.7-4.9-6.75V3.65L8 1.85z" /><path d="M5.95 7.75l1.45 1.45 2.7-2.95" /></svg>; }
function PermShieldWrite(props) { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d="M8 1.85l4.9 1.8v3.45c0 4.05-3.05 5.9-4.9 6.75-1.85-.85-4.9-2.7-4.9-6.75V3.65L8 1.85z" /><path d="M5.7 9.55l.35-1.5 2.6-2.6 1.2 1.2-2.6 2.6-1.55.3z" /></svg>; }
function PermShieldFull(props) { return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d="M8 1.85l4.9 1.8v3.45c0 4.05-3.05 5.9-4.9 6.75-1.85-.85-4.9-2.7-4.9-6.75V3.65L8 1.85z" /><path d="M8 4.75v3.4" /><path d="M8 9.85v.85" /></svg>; }
const ICONS = {
  play: PlayIcon, pause: PauseIcon, stop: StopIcon, back: ArrowLeftIcon, reload: ReloadIcon,
  go: ArrowRightIcon, settings: GearIcon, sun: SunIcon, moon: MoonIcon,
  trash: TrashIcon, clock: ClockIcon, sparkles: MagicWandIcon, globe: GlobeIcon,
  code: CodeIcon, network: ActivityLogIcon, file: FileIcon, terminal: CodeIcon,
  tool: MixerHorizontalIcon, send: ArrowUpIcon, x: Cross2Icon, check: CheckIcon,
  download: DownloadIcon, report: FileTextIcon, info: InfoCircledIcon, broom: ResetIcon,
  minus: MinusIcon, square: SquareIcon, restore: CopyIcon, plus: PlusIcon,
  more: DotsHorizontalIcon, chat: ChatBubbleIcon, copy: CopyIcon, folder: FolderGlyph,
  flag: DrawingPinIcon, key: LockClosedIcon, search: MagnifyingGlassIcon, layers: StackIcon,
  chevup: ChevronUpIcon, chevdown: ChevronDownIcon, chevright: ChevronRightIcon, chevleft: ChevronLeftIcon,
  dot: DotFilledIcon, sidebar: SidebarLeftGlyph, sidebarRight: SidebarRightGlyph, dashboard: DashboardIcon,
  target: TargetIcon, desktop: DesktopIcon, external: ExternalLinkIcon, bolt: LightningBoltIcon, edit: Pencil1Icon,
  pin: DrawingPinIcon, mobile: MobileIcon,
  user: PersonIcon, feedback: PaperPlaneIcon, logout: ExitIcon,
  thumbup: ThumbUpGlyph, thumbdown: ThumbDownGlyph,
  'shield-check': PermShield, 'shield-write': PermShieldWrite, 'shield-full': PermShieldFull,
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

export const DocumentLinks = React.createContext(null);

// 流式输出时每个 token 都会触发一次 text 变化。若每次同步重算 Markdown 并重建
// 整个 innerHTML，已渲染的文字会被反复销毁/重建 —— 这正是「打字机效果时上面的文字在闪」。
// 这里在流式期间按帧合并更新，并在结束后用最终内容渲染一次。
function useFlowText(text, streaming) {
  const [shown, setShown] = React.useState(text);
  const pending = useRef(text);
  const frame = useRef(0);
  pending.current = text;
  React.useEffect(() => {
    if (!streaming) {
      // 流式结束：立刻用最终内容，避免末尾几个字符丢失。
      if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
      setShown(text);
      return;
    }
    // 流式中：同一帧内多次变化只渲染一次。
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setShown(pending.current);
    });
  }, [text, streaming]);
  React.useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
  return shown;
}

export function Markdown({ text, basePath, root, streaming = false }) {
  const ref = useRef();
  const open = React.useContext(DocumentLinks);
  const shown = useFlowText(text, streaming);
  // 流式期间不跑高亮：dangerouslySetInnerHTML 每次都会重建 DOM，此时高亮的成果下一帧就被丢掉，
  // 只是白白让每个 token 对全部代码块重复解析（代码块多的回复会明显闪）。
  // 流式结束后统一高亮一次。
  useEffect(() => { if (!streaming && ref.current) highlightHtml(ref.current); }, [shown, streaming]);
  return <div className="md" ref={ref} onClick={e => { const link = e.target.closest('a[href]'); if (!link) return; e.preventDefault(); const href = link.getAttribute('href'); if (href?.startsWith('#')) { ref.current?.querySelector('[id="' + CSS.escape(href.slice(1)) + '"]')?.scrollIntoView(); return; } open?.(href, { basePath, root }); }} dangerouslySetInnerHTML={{ __html: renderMd(shown) }} />;
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

// 风险确认框：主操作在勾选「我已了解风险」之前一直是禁用的。
// 对应 DSH 的 RiskConfirmation（ui-primitives/src/RiskConfirmation.tsx）——
// 那道勾选是唯一阻止「顺手一点就开了完全权限」的东西，不能退化成两个按钮的普通确认。
export function askRiskConfirm({ title, description, acknowledge = '我已了解风险，并愿意继续', cancel = '取消', confirm }) {
  return mountPromise(done => {
    const [checked, setChecked] = useState(false);
    return <Dialog.Root open onOpenChange={o => { if (!o) done(false); }}>
      <Dialog.Content maxWidth="460px">
        <Dialog.Title size="4">{title}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mt="2" style={{ lineHeight: 1.7 }}>{description}</Dialog.Description>
        <Text as="label" size="2" mt="5" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', lineHeight: 1.7, cursor: 'pointer' }}>
          <Checkbox size="2" mt="1" checked={checked} onCheckedChange={v => setChecked(v === true)} aria-label={acknowledge} />
          <span>{acknowledge}</span>
        </Text>
        <Flex justify="end" gap="2" mt="5">
          <Button size="2" variant="soft" color="gray" onClick={() => done(false)}>{cancel}</Button>
          <Button size="2" color="red" disabled={!checked} onClick={() => done(true)}>{confirm}</Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>;
  });
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
