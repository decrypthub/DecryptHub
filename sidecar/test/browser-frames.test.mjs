import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserFrames } from '../../ui/src/browser-frames.js';

function fixture() {
  const images = [], drawings = [], cleared = [];
  const frames = new BrowserFrames(() => {
    const image = { width: 640, height: 480 };
    images.push(image);
    return image;
  });
  const canvas = name => ({
    width: 300, height: 150,
    getContext: () => ({ drawImage: image => drawings.push([name, image.src]), clearRect: () => cleared.push(name) }),
  });
  return { frames, images, drawings, cleared, canvas };
}

test('a remounted canvas restores the latest frame without another browser event', () => {
  const { frames, images, drawings, canvas } = fixture();
  frames.select('chat-a/page-a');
  frames.bind(canvas('first'));
  frames.receive('chat-a/page-a', { data: 'initial', fmt: 'jpeg' });
  images.at(-1).onload();
  frames.bind(null);
  frames.receive('chat-a/page-a', { data: 'latest', fmt: 'png' });
  const restored = canvas('restored'); frames.bind(restored);
  images.at(-1).onload();
  assert.deepEqual(drawings, [['first', 'data:image/jpeg;base64,initial'], ['restored', 'data:image/png;base64,latest']]);
  assert.equal(restored.width, 640); assert.equal(restored.height, 480);
});

test('unmounted canvases and superseded decodes cannot receive late pixels', () => {
  const { frames, images, drawings, canvas } = fixture();
  frames.select('chat-a/page-a'); frames.bind(canvas('old'));
  frames.receive('chat-a/page-a', { data: 'old' });
  const pending = images.at(-1);
  frames.bind(null); frames.bind(canvas('new'));
  pending.onload();
  assert.deepEqual(drawings, []);
  const restored = images.at(-1);
  frames.receive('chat-a/page-a', { data: 'new' });
  restored.onload(); images.at(-1).onload();
  assert.deepEqual(drawings, [['new', 'data:image/jpeg;base64,new']]);
});

test('switching chat, page, URL or browser lifetime drops cached and pending frames', () => {
  for (const next of ['other-chat/page-a/url-a/pid-a', 'chat-a/other-page/url-a/pid-a', 'chat-a/page-a/other-url/pid-a', 'chat-a/page-a/url-a/other-pid', null]) {
    const { frames, images, drawings, cleared, canvas } = fixture();
    const original = 'chat-a/page-a/url-a/pid-a';
    frames.select(original); frames.bind(canvas('visible'));
    frames.receive(original, { data: 'private-old-frame' });
    const pending = images.at(-1);
    frames.select(next); pending.onload();
    frames.receive(original, { data: 'late-old-frame' });
    frames.bind(null); frames.bind(canvas('new'));
    assert.equal(frames.frame, null); assert.deepEqual(drawings, []); assert.deepEqual(cleared, ['visible']);
  }
});

test('selecting the same target keeps a static frame for a later mount', () => {
  const { frames, images, drawings, canvas } = fixture();
  frames.select('chat-a/page-a'); frames.receive('chat-a/page-a', { data: 'static' });
  frames.select('chat-a/page-a'); frames.bind(canvas('restored')); images.at(-1).onload();
  assert.deepEqual(drawings, [['restored', 'data:image/jpeg;base64,static']]);
});
