import React, { useEffect, useState } from 'react';
import { Dialog, Popover, Text, TextField, Flex, Select } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, ActionIcon, Icon, askConfirm } from './kit.jsx';
import { native } from './transport.js';

export function ProjectPicker() {
  const w = useWorkbench(), [open, setOpen] = useState(false), [query, setQuery] = useState('');
  const ws = w.session?.workspace, project = w.projects.find(p => p.id === w.session?.projectId);
  useEffect(() => setOpen(false), [w.sid]);
  const select = async id => {
    const sid = w.sid;
    try { await w.api.invoke('project-attach', { sessionId: sid, projectId: id }); if (w.isCurrentSession(sid)) { setOpen(false); w.setWorkspacePrompt(false); } }
    catch (error) { w.toast(error.message, 'err'); }
  };
  return <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (value) setQuery(''); }}>
    <Popover.Trigger><Button className="workspace-picker" size="2" variant="soft" color="gray" disabled={w.cur.agentRunning} title={ws?.root}>
      <Icon n="folder" /><span className="ellipsis">{project?.name || '选择项目'}</span><Icon n="chevdown" />
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
    setForm(source ? { id: source.id, name: source.name || '', folders: (source.folders || []).filter(f => !source.relink || f.id !== source.primaryId).map(f => ({ ...f, key: f.id })), primaryKey: source.relink ? null : source.primaryId, sessionId: 'project-' + crypto.randomUUID() } : null);
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
      const project = await w.api.invoke('project-save', { scope: form.sessionId, project: form });
      if (!form.id) {
        await w.newSession(project.id);
      }
      w.setProjectEditor(null); w.setWorkspacePrompt(false);
      w.toast('项目已保存', 'ok');
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <>
    <Dialog.Root open={!!source && !source.deleting} onOpenChange={v => { if (!v && !busy) w.setProjectEditor(null); }}>
      <Dialog.Content maxWidth={source?.renameOnly ? '420px' : '600px'} data-overlay><Dialog.Title>{source?.renameOnly ? '重命名项目' : source?.relink ? '重新连接项目目录' : source?.id ? '编辑项目' : '新建项目'}</Dialog.Title>
        <Dialog.Description size="2" color="gray">{source?.renameOnly ? '设置容易辨认的项目名称，保留目录绑定和其中的会话。' : '将相关代码目录放在同一个项目。主目录用于执行和写入，附加目录供 Agent 读取代码。'}</Dialog.Description>
        {form && <form onSubmit={save}>
          <TextField.Root mt="4" aria-label="项目名称" placeholder="项目名称" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
          {!source?.renameOnly && <><div className="project-folder-list">{form.folders.map(folder => <div className="project-folder" key={folder.key}>
            <Icon n="folder" /><div><strong>{folder.label}</strong><small className="mono">{folder.root}</small></div>
            <Button type="button" size="1" variant="soft" color="gray" onClick={() => setForm({ ...form, primaryKey: folder.key })}>{form.primaryKey === folder.key ? '主目录' : '设为主目录'}</Button>
            <ActionIcon icon="x" type="button" title="移除目录" onClick={() => setForm({ ...form, folders: form.folders.filter(f => f.key !== folder.key), primaryKey: form.primaryKey === folder.key ? form.folders.find(f => f.key !== folder.key)?.key : form.primaryKey })} />
          </div>)}</div>
          <Button type="button" size="2" variant="soft" color="gray" disabled={busy || form.folders.length >= 12} onClick={add}><Icon n="plus" />添加目录</Button></>}
          {error && <Text as="p" size="2" color="red" role="alert">{error}</Text>}
          <Flex justify="between" align="center" mt="5">
            {form.id ? <Button type="button" color="red" variant="ghost" disabled={busy} onClick={() => w.setProjectEditor({ ...source, deleting: true })}>删除项目…</Button> : <span />}
            <Flex gap="2"><Button type="button" variant="soft" color="gray" disabled={busy} onClick={() => w.setProjectEditor(null)}>取消</Button><Button type="submit" loading={busy} disabled={!form.name.trim() || !form.folders.length}>保存项目</Button></Flex>
          </Flex>
        </form>}
      </Dialog.Content>
    </Dialog.Root>
    <Dialog.Root open={!!w.workspacePrompt} onOpenChange={w.setWorkspacePrompt}>
      <Dialog.Content maxWidth="460px" data-overlay><Dialog.Title>选择项目</Dialog.Title><Dialog.Description size="2" color="gray">每个会话都在项目目录中工作。选择已有项目，或添加目录创建项目。</Dialog.Description>
        <div className="workspace-start-choices">
          {w.projects.map(p => <Button key={p.id} size="2" variant="soft" color="gray" onClick={async () => {
            try {
              await w.newSession(p.id);
              w.setWorkspacePrompt(false);
            } catch (e) { w.toast(e.message, 'err'); }
          }}><Icon n="folder" />{p.name}</Button>)}
          <Button size="3" variant="soft" color="gray" onClick={() => { w.setWorkspacePrompt(false); w.setProjectEditor({}); }}><Icon n="plus" />添加项目目录…</Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
    <Dialog.Root open={!!w.moveSession} onOpenChange={v => { if (!v) w.setMoveSession(null); }}>
      <Dialog.Content maxWidth="430px" data-overlay><Dialog.Title>移动会话到项目</Dialog.Title><Dialog.Description size="2" color="gray">加入项目后使用它的目录上下文，保留原对话内容。</Dialog.Description><div className="workspace-start-choices">
        {w.projects.map(p => <Button key={p.id} size="2" variant="soft" color="gray" onClick={async () => {
          const id = w.moveSession;
          try { await w.api.invoke('project-attach', { sessionId: id, projectId: p.id }); w.setMoveSession(null); }
          catch (e) { w.toast(e.message, 'err'); }
        }}>{p.name}</Button>)}
      </div></Dialog.Content>
    </Dialog.Root>
    {source?.deleting && <DeleteProject project={source} onClose={() => w.setProjectEditor(null)} />}
  </>;
}

function DeleteProject({ project, onClose }) {
  const w = useWorkbench(), [target, setTarget] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const count = w.sessions.sessions.filter(s => s.projectId === project.id).length;
  const remove = async () => {
    if (target === 'delete' && count && !await askConfirm(`删除“${project.name}”及其中 ${count} 个会话？会话记录、附件和浏览器数据将永久删除，项目目录及源码文件保留。`, { ok: '删除项目及会话', danger: true })) return;
    setBusy(true); setError('');
    try { await w.api.invoke('project-remove', { id: project.id, targetId: target === 'delete' ? null : target || null, deleteSessions: target === 'delete' }); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Dialog.Content maxWidth="460px" data-overlay><Dialog.Title>删除项目</Dialog.Title><Dialog.Description size="2" color="gray">删除“{project.name}”的应用记录，磁盘目录和源码文件保留。{count ? `请先决定其中 ${count} 个会话如何处理。` : '这个项目没有会话。'}</Dialog.Description>
      {!!count && <Flex direction="column" gap="2" mt="4"><Text as="label" size="2">项目内的会话</Text><Select.Root value={target} onValueChange={setTarget}><Select.Trigger placeholder="选择处理方式" aria-label="项目会话处理方式" /><Select.Content>
        {w.projects.filter(p => p.id !== project.id).map(p => <Select.Item key={p.id} value={p.id}>迁移到 {p.name}</Select.Item>)}
        <Select.Item value="delete">删除项目内全部会话</Select.Item>
      </Select.Content></Select.Root></Flex>}
      {error && <Text as="p" size="2" color="red" role="alert">{error}</Text>}
      <Flex justify="end" gap="2" mt="5"><Button variant="soft" color="gray" disabled={busy} onClick={onClose}>取消</Button><Button color="red" disabled={busy || (!!count && !target)} onClick={remove}>{busy ? '处理中…' : '删除项目'}</Button></Flex>
    </Dialog.Content>
  </Dialog.Root>;
}
