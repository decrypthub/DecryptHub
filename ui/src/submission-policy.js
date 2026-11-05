// Enter and Send have the same policy. The accelerated chord chooses the other
// delivery while busy; Host decides whether the current step still admits it.
export function submitMode(preferred, running, accelerated = false) {
  if (!running) return 'queue';
  const normal = preferred === 'steer' ? 'steer' : 'queue';
  return accelerated ? normal === 'queue' ? 'steer' : 'queue' : normal;
}
