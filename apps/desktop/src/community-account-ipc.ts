/** Private native community-account channel names. */
export const COMMUNITY_ACCOUNT_IPC = {
  get: 'decrypthub-account:get', refresh: 'decrypthub-account:refresh', start: 'decrypthub-account:start',
  cancel: 'decrypthub-account:cancel', signOut: 'decrypthub-account:sign-out',
  open: 'decrypthub-account:open', changed: 'decrypthub-account:changed',
} as const
