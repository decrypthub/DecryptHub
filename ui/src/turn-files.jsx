import React, { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { Button, Icon } from './kit.jsx';
import { workspaceKey } from './dock-tabs.js';

const label = path => path.split(/[\\/]/).at(-1);
function Counts({ file }) {
  return file.binary ? '二进制文件' : file.oversized ? '文件较大' : <><span className="file-added">+{file.added}</span><span className="file-deleted">−{file.deleted}</span></>;
}
export function TurnFiles({ turn }) {
  const w = useWorkbench(), [files, setFiles] = useState([]), [expanded, setExpanded] = useState(false);
  const identity = workspaceKey(w.session?.workspace);
  useEffect(() => {
    if (!turn.endedAt) return;
    let live = true;
    w.api.invoke('turn-files', { sessionId: w.sid, runId: turn.id }).then(value => { if (live) setFiles(value.files); }).catch(() => { if (live) setFiles([]); });
    return () => { live = false; };
  }, [w.sid, identity, turn.id, turn.endedAt, w.cur.changesVersion]);
  if (!files.length) return null;
  const single = files.length === 1, total = { added: files.reduce((n, file) => n + (file.added || 0), 0), deleted: files.reduce((n, file) => n + (file.deleted || 0), 0) };
  const open = file => w.tabs.openChange(turn.id, file.path);
  return <section className="turn-file-card" aria-label="本轮文件改动">
    <button type="button" className="turn-file-head" title={single ? files[0].path : '查看本轮文件改动'} onClick={() => open(files[0])}>
      <span className="turn-file-icon"><Icon n="file" size={25} /></span><span><strong>{single ? '已编辑 ' + label(files[0].path) : `已编辑 ${files.length} 个文件`}</strong><span className="turn-file-counts"><Counts file={single ? files[0] : total} /></span></span><Icon n="chevright" size={16} />
    </button>
    {!single && <ul>{(expanded ? files : files.slice(0, 4)).map(file => <li key={file.path}><button type="button" className="turn-file-row" onClick={() => open(file)} title={file.path}><span className="ellipsis">{file.path}</span><span className="turn-file-counts"><Counts file={file} /></span></button></li>)}</ul>}
    {files.length > 4 && <button type="button" className="turn-file-toggle" onClick={() => setExpanded(value => !value)}>{expanded ? '收起文件' : `查看全部 ${files.length} 个文件`}<Icon n={expanded ? 'chevup' : 'chevdown'} /></button>}
  </section>;
}

export function ChangeReview({ tab }) {
  const w = useWorkbench(), [value, setValue] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let live = true; setValue(null); setError('');
    if (tab.workspace !== workspaceKey(w.session?.workspace)) { setError('工作区已变化，请从对应对话重新打开改动。'); return; }
    w.api.invoke('turn-file-detail', { sessionId: w.sid, runId: tab.runId, path: tab.path }).then(result => { if (live) setValue(result); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [w.sid, tab.runId, tab.path, tab.workspace, workspaceKey(w.session?.workspace)]);
  return <section className="change-review" aria-label={'文件改动 ' + tab.path}>
    <div className="bar"><Text size="1" className="mono ellipsis" title={tab.path}>{tab.path}</Text><span className="spacer" /><Button size="1" color="gray" variant="soft" onClick={() => w.tabs.openDocument(tab.path)}>查看当前文件<Icon n="external" size={14} /></Button></div>
    {error ? <Text color="red" m="3" role="alert">{error}</Text> : !value ? <Text color="gray" m="3">正在读取改动…</Text> : value.oversized || value.binary ? <Text color="gray" m="3">{value.binary ? '二进制内容无法以文本比较。' : '文件较大，未加载完整比较。'}</Text> : <div className="change-comparison"><div><div className="change-side-title">修改前</div><pre>{value.before ?? '（文件不存在）'}</pre></div><div><div className="change-side-title">修改后</div><pre>{value.after ?? '（文件已删除）'}</pre></div></div>}
  </section>;
}
