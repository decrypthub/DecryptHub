import React, { useEffect, useState } from 'react';
import { Text, Tabs } from '@radix-ui/themes';
import { useWorkbench } from './bus.jsx';
import { ActionIcon, Markdown } from './kit.jsx';
import { workspaceKey } from './dock-tabs.js';
export function DocumentPanel({ tab }) {
  const w = useWorkbench(), [document, setDocument] = useState(null), [error, setError] = useState(''), [mode, setMode] = useState('preview'), [revision, refresh] = useState(0);
  useEffect(() => { let live = true; setError(''); setDocument(null);
    w.api.invoke('document-read', { sessionId: w.sid, ...tab }).then(v => { if (live) setDocument(v); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [w.sid, tab.path, tab.root, tab.workspace, workspaceKey(w.session?.workspace), revision]);
  return <section className="document-panel" aria-label={'文档 ' + tab.title}>
    <div className="bar document-toolbar"><Text size="1" className="mono ellipsis" title={tab.path}>{tab.path}</Text><span className="spacer" />{document?.markdown && <Tabs.Root value={mode} onValueChange={setMode}><Tabs.List size="1"><Tabs.Trigger value="preview">预览</Tabs.Trigger><Tabs.Trigger value="source">源码</Tabs.Trigger></Tabs.List></Tabs.Root>}<ActionIcon icon="reload" title="刷新文档" onClick={() => refresh(r => r + 1)} /><ActionIcon icon="copy" title="复制文档内容" disabled={!document} onClick={() => navigator.clipboard.writeText(document.content).then(() => w.toast('已复制', 'ok')).catch(e => w.toast(e.message, 'err'))} /></div>
    {error ? <Text as="p" m="4" color="red" role="alert">{error}</Text> : !document ? <Text as="p" m="4" color="gray">正在读取文档…</Text> : document.markdown && mode === 'preview' ? <div className="document-content"><Markdown text={document.content} basePath={document.path} root={tab.root} /></div> : <pre className="raw document-content">{document.content}</pre>}
  </section>;
}
