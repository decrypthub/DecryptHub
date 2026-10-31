import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Avatar, Card, DropdownMenu, Flex, Spinner, Text } from '@radix-ui/themes';
import { native } from './transport.js';
import { useWorkbench } from './bus.jsx';
import { Button, Icon, NavButton } from './kit.jsx';
import { Section, Row } from './settings-kit.jsx';
import { accountErrorMessage } from './account-errors.js';

const AccountContext = createContext(null);
const waiting = phase => phase === 'waiting-browser' || phase === 'exchanging';

// The native bridge returns only safe snapshots. No credential or verifier is
// passed through this provider, the sidecar bus, or browser storage.
export function AccountProvider({ children }) {
  const { setView, toast } = useWorkbench();
  const [snapshot, setSnapshot] = useState({ available: native.isNative(), phase: 'loading', profile: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [settingsRequest, setSettingsRequest] = useState(0);
  const [avatar, setAvatar] = useState(null);
  const epoch = useRef(0), mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const version = ++epoch.current;
    native.accountStatus(true).then(value => { if (mounted.current && epoch.current === version) setSnapshot(value); })
      .catch(e => { if (mounted.current && epoch.current === version) { setError(accountErrorMessage(e)); setSnapshot(s => ({ ...s, phase: 'signed-out' })); } });
    return () => { mounted.current = false; epoch.current++; };
  }, []);
  useEffect(() => {
    if (!waiting(snapshot.phase) || busy) return;
    let disposed = false, timer;
    const version = epoch.current;
    async function poll() {
      try {
        const value = await native.accountStatus();
        if (!disposed && mounted.current && epoch.current === version) setSnapshot(value);
      } catch (e) { if (!disposed && epoch.current === version) setError(accountErrorMessage(e)); }
      if (!disposed && epoch.current === version) timer = setTimeout(poll, 1000);
    }
    timer = setTimeout(poll, 500);
    return () => { disposed = true; clearTimeout(timer); };
  }, [snapshot.phase, busy]);
  useEffect(() => {
    let disposed = false;
    const id = snapshot.profile?.id;
    const url = snapshot.profile?.avatarUrl;
    if (id && url) native.accountAvatar().then(data => { if (!disposed) setAvatar({ id, url, data }); }).catch(() => {});
    return () => { disposed = true; };
  }, [snapshot.profile?.id, snapshot.profile?.avatarUrl]);
  async function act(operation) {
    if (busy) return;
    const version = ++epoch.current;
    setBusy(true); setError('');
    try {
      const value = await operation();
      if (mounted.current && epoch.current === version && value?.phase) setSnapshot(value);
    } catch (e) { if (mounted.current && epoch.current === version) { const message = accountErrorMessage(e); setError(message); toast(message, 'err'); } }
    finally { if (mounted.current && epoch.current === version) setBusy(false); }
  }
  const openSettings = () => { setSettingsRequest(n => n + 1); setView('settings'); };
  return <AccountContext.Provider value={{ ...snapshot, avatar: avatar?.id === snapshot.profile?.id && avatar?.url === snapshot.profile?.avatarUrl ? avatar?.data : null, error: error || snapshot.error, busy, settingsRequest, openSettings,
    login: () => act(native.accountLogin), cancel: () => act(native.accountCancel), logout: () => act(native.accountLogout),
    refresh: () => act(() => native.accountStatus(true)), reopen: () => act(native.accountReopenLogin),
    openPage: page => act(() => native.accountOpenPage(page)),
  }}>{children}</AccountContext.Provider>;
}
export const useAccount = () => useContext(AccountContext);

function AccountAvatar({ profile, data, size = '4' }) {
  let src;
  if (profile && typeof data === 'string' && data.length < 720000 && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) src = data;
  return <span className="account-avatar-slot"><Avatar size={size} radius="full" src={src} fallback={profile?.nickname?.slice(0, 1) || <Icon n="user" size={20} />} referrerPolicy="no-referrer" /></span>;
}

export function AccountTab() {
  const a = useAccount();
  const pending = waiting(a.phase), signedIn = !!a.profile, disabled = a.busy || a.phase === 'loading';
  return <Section title="DecryptHub 账号" desc="在浏览器中登录社区账号，在桌面继续使用。">
    <Card size="3" className="account-card">
      <div className="account-identity"><AccountAvatar profile={a.profile} data={a.avatar} size="5" /><div className="account-identity-text">
        <Text as="div" size="4" weight="bold">{a.profile?.nickname || (a.phase === 'loading' ? '正在读取账号…' : '登录 DecryptHub')}</Text>
        <Text as="div" size="2" color="gray" mt="1">{signedIn ? '@' + a.profile.handle : '使用你的社区账号，管理个人资料。'}</Text>
      </div></div>
      {a.error && <Text as="p" size="2" color="red" role="alert" className="account-message">{a.error}</Text>}
      {pending ? <div className="account-wait" role="status"><Spinner size="2" /><div><Text as="div" size="2" weight="medium">{a.phase === 'exchanging' ? '正在完成登录…' : '请在浏览器中确认登录'}</Text><Text as="div" size="1" color="gray" mt="1">完成后会自动返回账号状态。</Text></div></div> : !signedIn && <Text as="p" size="2" color="gray" className="account-message">登录不会上传本地项目或对话，模型渠道继续使用你配置的 API Key。</Text>}
      <Flex gap="3" wrap="wrap" mt="5">
        {pending ? <><Button size="2" variant="soft" color="gray" disabled={a.busy} onClick={a.reopen}><Icon n="external" />重新打开浏览器</Button><Button size="2" variant="soft" color="gray" disabled={a.busy} onClick={a.cancel}>取消登录</Button></> : signedIn ? <><Button size="2" variant="soft" color="gray" disabled={disabled} onClick={() => a.openPage('profile')}><Icon n="external" />管理个人资料</Button><Button size="2" variant="soft" color="gray" disabled={disabled} onClick={a.refresh}><Icon n="reload" />刷新</Button></> : <Button size="3" disabled={disabled || !a.available} onClick={a.login}><Icon n="external" />在浏览器中登录</Button>}
      </Flex>
      {!a.available && <Text as="p" size="1" color="gray" mt="3">请在 DecryptHub 桌面应用中登录，网页开发预览不保存账号凭据。</Text>}
    </Card>
    {signedIn && <Card size="2" mt="4"><Row label="账号安全" desc="在社区网页管理登录方式与账号安全。"><Button variant="soft" color="gray" size="2" disabled={disabled} onClick={() => a.openPage('security')}><Icon n="external" />打开</Button></Row><Row label="退出此设备" desc="保留本地项目、对话及模型设置。"><Button variant="soft" color="gray" size="2" disabled={disabled} onClick={a.logout}>退出登录</Button></Row></Card>}
  </Section>;
}

export function SidebarAccount() {
  const a = useAccount();
  const w = useWorkbench(), [open, setOpen] = useState(false);
  const pending = waiting(a.phase), disabled = a.busy || a.phase === 'loading';
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const login = () => { a.openSettings(); if (a.available && !pending) void a.login(); };
  const feedback = async event => {
    if (!native.isNative()) return;
    event.preventDefault();
    setOpen(false);
    try { await w.api.invoke('feedback-open'); } catch { w.toast('无法打开反馈页面，请稍后重试。', 'err'); }
  };
  return <DropdownMenu.Root open={open} onOpenChange={setOpen}><DropdownMenu.Trigger><NavButton className="rail-account" aria-label={a.profile ? '账号菜单' : '更多'}>
    {a.profile ? <AccountAvatar profile={a.profile} data={a.avatar} size="2" /> : <Icon n="more" size={20} />}
    <span className="ellipsis">{a.profile?.nickname || '更多'}</span>
  </NavButton></DropdownMenu.Trigger><DropdownMenu.Content className="account-menu" size="2" align="start" side="top" sideOffset={8} collisionPadding={12} data-overlay>
    <DropdownMenu.Item shortcut={mac ? '⌘ ,' : 'Ctrl ,'} onSelect={() => w.setView('settings')}><Icon n="settings" size={18} />设置</DropdownMenu.Item>
    <DropdownMenu.Item asChild><a href="https://github.com/decrypthub/DecryptHub/issues/new/choose" target="_blank" rel="noopener noreferrer" onClick={feedback}><Icon n="feedback" size={18} />意见反馈</a></DropdownMenu.Item>
    {a.profile ? <DropdownMenu.Item disabled={disabled} onSelect={a.logout}><Icon n="logout" size={18} />退出登录</DropdownMenu.Item>
      : <DropdownMenu.Item disabled={disabled} onSelect={login}>{pending ? <Spinner size="1" /> : <Icon n="user" size={18} />}{pending ? '继续登录' : '登录'}</DropdownMenu.Item>}
  </DropdownMenu.Content></DropdownMenu.Root>;
}
