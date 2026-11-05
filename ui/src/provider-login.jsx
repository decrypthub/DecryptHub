import React, { useEffect, useRef, useState } from 'react';
import { Dialog, Flex, Text, TextField, Spinner } from '@radix-ui/themes';
import { Button } from './kit.jsx';
import { useWorkbench } from './bus.jsx';
import { useCompositionGuard } from './use-composition-guard.js';
import { isSubmitEnter } from './composition-guard.js';
export function ProviderLogin({ request, onClose }) {
  const w = useWorkbench(), [state, setState] = useState(null), [answer, setAnswer] = useState(''), id = useRef(null);
  const composition = useCompositionGuard(request.routeId + ':' + (state?.prompt?.id || ''));
  useEffect(() => {
    let active = true;
    const off = w.api.on('provider-authorization', update => { if (active && update.routeId === request.routeId) { id.current = update.id; setState(update); } });
    w.api.invoke('provider-auth-start', request).then(async update => { id.current = update.id; if (active) setState(await w.api.invoke('provider-auth-status', { id: update.id })); }).catch(error => active && setState({ status: 'failed', error: error.message }));
    return () => { active = false; off(); if (id.current) void w.api.invoke('provider-auth-cancel', { id: id.current }).catch(() => {}); };
  }, [request.routeId, request.method]);
  useEffect(() => { setAnswer(''); }, [state?.prompt?.id]);
  useEffect(() => { if (state?.status === 'completed') w.api.invoke('get-settings').then(w.setSettings).catch(() => {}); }, [state?.status]);
  const respond = async value => { try { await w.api.invoke('provider-auth-answer', { id: state.id, promptId: state.prompt.id, value }); setAnswer(''); } catch (error) { w.toast(error.message, 'err'); } };
  const link = state?.notice?.url || state?.notice?.verificationUri || state?.notice?.links?.[0]?.url;
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}><Dialog.Content maxWidth="520px"><Dialog.Title>连接供应商</Dialog.Title><Dialog.Description size="2">在供应商的登录流程中完成认证，凭据保存在系统凭据库。</Dialog.Description>
    {(!state || state.status === 'pending') && <Flex gap="2" align="center" my="3"><Spinner size="1" /><Text size="2">{state?.notice?.message || state?.notice?.instructions || '等待认证…'}</Text></Flex>}
    {link && <Button size="2" variant="soft" onClick={() => w.api.invoke('provider-auth-open', { id: state.id }).catch(error => w.toast(error.message, 'err'))}>打开供应商登录页面</Button>}
    {state?.notice?.userCode && <Text as="div" size="5" my="3" className="mono">{state.notice.userCode}</Text>}
    {state?.prompt && <div key={state.prompt.id}><Text as="div" size="2" mt="3" mb="2">{state.prompt.message}</Text>
      {state.prompt.type === 'select' ? <Flex direction="column" gap="2">{state.prompt.options.map(option => <Button key={option.id} variant="soft" onClick={() => respond(option.id)}>{option.label}</Button>)}</Flex>
        : <><TextField.Root ref={composition.ref} type={state.prompt.type === 'secret' ? 'password' : 'text'} value={answer} onChange={event => setAnswer(event.target.value)} placeholder={state.prompt.placeholder} aria-label="供应商登录输入" onKeyDown={event => { if (!composition.isComposing(event) && isSubmitEnter(event)) { event.preventDefault(); respond(answer); } }} /><Button mt="2" size="2" onClick={() => respond(answer)}>继续</Button></>}
    </div>}
    {state?.error && <Text as="div" color="red" my="3">{state.error}</Text>}
    {state?.status === 'completed' && <Text as="div" color="green" my="3">已完成认证并保存凭据。</Text>}
    <Flex justify="end" mt="4"><Button size="2" variant="soft" color="gray" onClick={onClose}>{state?.status === 'completed' ? '完成' : '关闭'}</Button></Flex>
  </Dialog.Content></Dialog.Root>;
}
