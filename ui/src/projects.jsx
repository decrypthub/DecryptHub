import React, { useEffect, useState } from 'react';
import { Dialog, Popover, Text, TextField, Flex } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, Icon, askConfirm } from './kit.jsx';
import { native } from './transport.js';

export async function chooseFolder(w) {
  if (!native.isNative()) { w.toast('请在桌面应用中选择本地目录。预览中可选择“不在目录中工作”。', 'info'); return; }
  const sid = w.sid, grant = await native.pickWorkspace(sid);
  if (grant) { await w.api.invoke('workspace-set', { sessionId: sid, grant }); if (w.isCurrentSession(sid)) w.setWorkspacePrompt(false); }
}
export function ProjectPicker() {
  const w = useWorkbench(), [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const ws = w.session?.workspace, project = w.projects.find(p => p.id === w.session?.projectId);
  useEffect(() => setOpen(false), [w.sid]);
  const select = async id => {
    const sid = w.sid;
    try { await w.api.invoke('project-attach', { sessionId: sid, projectId: id }); if (w.isCurrentSession(sid)) { setOpen(false); w.setWorkspacePrompt(false); } }
    catch (error) { w.toast(error.message, 'err'); }
  };
  const managed = async () => {
    const sid = w.sid;
    try { await w.api.invoke('workspace-set', { sessionId: sid, managed: true }); if (w.isCurrentSession(sid)) { setOpen(false); w.setWorkspacePrompt(false); } }
    catch (error) { w.toast(error.message, 'err'); }
  };
  return <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (value) setQuery(''); }}>
    <Popover.Trigger><Button className="workspace-picker" size="2" variant="soft" color="gray" disabled={w.cur.agentRunning} title={ws?.kind === 'unselected' ? '选择项目或工作文件夹' : ws?.root}>
      <Icon n="folder" /><span className="ellipsis">{project?.name || (ws?.kind === 'unselected' ? '选择项目或文件夹' : ws?.kind === 'managed' ? '不在项目中工作' : ws?.label)}</span><Icon n="chevdown" />
    </Button></Popover.Trigger>
    <Popover.Content width="350px" align="start" side="top" data-overlay className="project-picker-panel">
      <TextField.Root value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索项目" aria-label="搜索项目"><TextField.Slot><Icon n="search" /></TextField.Slot></TextField.Root>
      <div className="project-choices">
        {w.projects.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).map(p => <button className="project-choice" key={p.id} onClick={() => select(p.id)}>
          <Icon n="folder" /><span>{p.name}<small>{p.folders.length} 个目录</small></span>{project?.id === p.id && <Icon n="check" />}
        </button>)}
        {!w.projects.length && <Text as="p" size="1" color="gray" m="2">创建项目以管理相关目录和会话。</Text>}
      </div>
      <div className="project-picker-actions">
        <button className="project-choice" onClick={() => { setOpen(false); w.setProjectEditor({}); }}><Icon n="plus" />新建项目</button>
        <button className="project-choice" onClick={async () => { try { await chooseFolder(w); setOpen(false); } catch (e) { w.toast(e.message, 'err'); } }}><Icon n="folder" />仅选择工作文件夹…</button>
        <button className="project-choice" onClick={managed}><Icon n="x" />不在目录中工作</button>
        {project && <button className="project-choice" onClick={() => { setOpen(false); w.setProjectEditor(project); }}><Icon n="settings" />编辑当前项目</button>}
      </div>
    </Popover.Content>
  </Popover.Root>;
}
export function ProjectDialogs() {
  const w = useWorkbench(), source = w.projectEditor;
  const [form, setForm] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    setError('');
    setForm(source ? { id: source.id, name: source.name || '', folders: (source.folders || []).map(f => ({ ...f, key: f.id })), primaryKey: source.primaryId, sessionId: w.sid } : null);
  }, [source]);
  const add = async () => {
    if (!native.isNative()) { setError('添加项目目录需要使用桌面原生文件夹选择器。'); return; }
    setBusy(true); setError('');
    try {
      const grant = await native.pickWorkspace(form.sessionId);
      if (grant) setForm(f => ({ ...f, folders: [...f.folders, { key: grant.signature, grant, root: grant.path, label: grant.path.split(/[\\/]/).pop() }], primaryKey: f.primaryKey || grant.signature }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const save = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const project = await w.api.invoke('project-save', { sessionId: form.sessionId, project: form });
      if (!form.id) await w.api.invoke('project-attach', { sessionId: form.sessionId, projectId: project.id });
      w.setProjectEditor(null); if (w.isCurrentSession(form.sessionId)) w.setWorkspacePrompt(false);
      w.toast('项目已保存', 'ok');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <>
    <Dialog.Root open={!!source} onOpenChange={v => { if (!v && !busy) w.setProjectEditor(null); }}>
      <Dialog.Content maxWidth="600px" data-overlay><Dialog.Title>{source?.id ? '编辑项目' : '新建项目'}</Dialog.Title>
        <Dialog.Description size="2" color="gray">将相关代码目录放在同一个项目。主目录用于执行和写入，附加目录供 Agent 读取代码。</Dialog.Description>
        {form && <form onSubmit={save}>
          <TextField.Root mt="4" aria-label="项目名称" placeholder="项目名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
          <div className="project-folder-list">{form.folders.map(folder => <div className="project-folder" key={folder.key}>
            <Icon n="folder" /><div><strong>{folder.label}</strong><small className="mono">{folder.root}</small></div>
            <Button type="button" size="1" variant="soft" color="gray" onClick={() => setForm({ ...form, primaryKey: folder.key })}>{form.primaryKey === folder.key ? '主目录' : '设为主目录'}</Button>
            <ActionIcon icon="x" type="button" title="移除目录" onClick={() => setForm({ ...form, folders: form.folders.filter(f => f.key !== folder.key), primaryKey: form.primaryKey === folder.key ? form.folders.find(f => f.key !== folder.key)?.key : form.primaryKey })} />
          </div>)}</div>
          <Button type="button" size="2" variant="soft" color="gray" disabled={busy || form.folders.length >= 12} onClick={add}><Icon n="plus" />添加目录</Button>
          {error && <Text as="p" size="2" color="red" role="alert">{error}</Text>}
          <Flex justify="between" align="center" mt="5">
            {form.id ? <Button type="button" color="red" variant="ghost" disabled={busy} onClick={async () => { if (!await askConfirm('移除项目？会话将保留当前主目录，磁盘文件不会删除。', { ok: '移除项目', danger: true })) return; try { await w.api.invoke('project-remove', { id: form.id }); w.setProjectEditor(null); } catch (e) { setError(e.message); } }}>移除项目</Button> : <span />}
            <Flex gap="2"><Button type="button" variant="soft" color="gray" disabled={busy} onClick={() => w.setProjectEditor(null)}>取消</Button><Button type="submit" loading={busy} disabled={!form.name.trim() || !form.folders.length}>保存项目</Button></Flex>
          </Flex>
        </form>}
      </Dialog.Content>
    </Dialog.Root>
    <Dialog.Root open={!!w.workspacePrompt} onOpenChange={w.setWorkspacePrompt}>
      <Dialog.Content maxWidth="460px" data-overlay><Dialog.Title>选择工作目录</Dialog.Title><Dialog.Description size="2" color="gray">先选择代码所在的目录。也可以不在目录中工作，临时文件会保存在本会话的工作区，之后可复制路径找回。</Dialog.Description>
        <div className="workspace-start-choices">
          <Button size="3" onClick={() => chooseFolder(w).catch(e => w.toast(e.message, 'err'))}><Icon n="folder" />选择工作文件夹…</Button>
          {w.projects.map(p => <Button key={p.id} size="2" variant="soft" color="gray" onClick={() => w.inv('project-attach', { projectId: p.id }).then(() => w.setWorkspacePrompt(false)).catch(e => w.toast(e.message, 'err'))}><Icon n="folder" />{p.name}</Button>)}
          <Button size="2" variant="soft" color="gray" onClick={() => w.inv('workspace-set', { managed: true }).then(() => w.setWorkspacePrompt(false)).catch(e => w.toast(e.message, 'err'))}>不在目录中工作</Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
    <Dialog.Root open={!!w.moveSession} onOpenChange={v => { if (!v) w.setMoveSession(null); }}>
      <Dialog.Content maxWidth="430px" data-overlay><Dialog.Title>移动会话到项目</Dialog.Title><Dialog.Description size="2" color="gray">加入项目后使用它的目录上下文，保留原对话内容。</Dialog.Description><div className="workspace-start-choices">
        {[{ id: null, name: '不属于项目（保留当前主目录）' }, ...w.projects].map(p => <Button key={p.id || 'none'} size="2" variant="soft" color="gray" onClick={() => w.api.invoke('project-attach', { sessionId: w.moveSession, projectId: p.id }).then(() => w.setMoveSession(null)).catch(e => w.toast(e.message, 'err'))}>{p.name}</Button>)}
      </div></Dialog.Content>
    </Dialog.Root>
  </>;
}
