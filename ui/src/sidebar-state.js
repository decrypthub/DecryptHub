export function readSidebarOpen(storage) {
  try { return storage.getItem('wdh_rail') !== 'closed'; }
  catch { return true; }
}

export function saveSidebarOpen(storage, open) {
  try { storage.setItem('wdh_rail', open ? 'open' : 'closed'); }
  catch {}
}
