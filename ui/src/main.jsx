import './transport.js';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme, Button } from '@radix-ui/themes';
import { Toaster } from 'sonner';
import '@radix-ui/themes/styles.css';
import './app.css';
import { Workbench } from './bus.jsx';
import { Shell } from './shell.jsx';
import { LogoMark, Icon } from './kit.jsx';
import { themeConfig } from './theme.js';

const saved = localStorage.getItem('jsra_theme') || 'system';

function useDark(theme) {
  const [dark, setDark] = useState(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    return theme === 'system' ? !mq.matches : theme === 'dark';
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => setDark(theme === 'system' ? !mq.matches : theme === 'dark');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); }, [dark]);
  return dark;
}

// 崩了要看见原因，而不是白屏
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error('[ui]', err, info?.componentStack); }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="fatal-error" role="alert">
      <LogoMark size={42} />
      <h1>工作区遇到了问题</h1>
      <p>重新加载后继续，或展开错误详情查看原因。</p>
      <Button onClick={() => location.reload()}><Icon n="reload" size={15} />重新加载工作区</Button>
      <details><summary>查看错误详情</summary><pre>{String(this.state.err?.stack || this.state.err)}</pre></details>
    </div>;
  }
}

function Root() {
  const [theme, setTheme] = useState(saved);
  const dark = useDark(theme);
  useEffect(() => { window.__setTheme = setTheme; }, []);
  return <Theme {...themeConfig} className="theme-root" appearance={dark ? 'dark' : 'light'}>
    <Boundary>
      <Workbench><Shell /></Workbench>
      <Toaster theme={dark ? 'dark' : 'light'} position="top-center" offset={60} closeButton visibleToasts={3}
        toastOptions={{ closeButtonAriaLabel: '关闭通知', style: { fontFamily: 'var(--default-font-family)' } }} />
    </Boundary>
  </Theme>;
}

createRoot(document.getElementById('root')).render(<Root />);
