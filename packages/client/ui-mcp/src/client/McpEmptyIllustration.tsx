/** Decorative server-and-connector artwork for the empty custom MCP list. */

/** Props for the decorative empty-state illustration. */
export interface McpEmptyIllustrationProps {
  readonly className?: string | undefined
}

/**
 * Render the empty-state illustration with theme-owned colors.
 * @param props - optional CSS class applied to the root SVG.
 * @returns the decorative inline SVG element.
 */
export function McpEmptyIllustration({ className }: McpEmptyIllustrationProps) {
  return (
    <svg className={className} width="170" height="170" viewBox="0 0 170 170" fill="none" aria-hidden="true" focusable="false">
      <path d="M150.987 110.561C150.987 129.672 136.871 141.213 111.398 141.213C85.9246 141.213 62.4355 129.672 62.4355 110.561C62.4355 91.4501 91.2279 75.8877 116.701 75.8877C142.174 75.8877 150.987 91.4501 150.987 110.561Z" fill="var(--dsw-alias-illustration-background)" />
      <path d="M22.8139 89.2533C34.8323 114.405 56.4234 111.743 81.1028 98.2593C105.782 84.7754 124.589 64.8493 112.571 39.6979C100.552 14.5466 55.3287 15.6524 30.6492 29.1363C5.96976 42.6202 10.7954 64.1019 22.8139 89.2533Z" fill="var(--dsw-alias-illustration-background)" />
      <rect x="34" y="34" width="68" height="86" rx="10" fill="var(--dsw-alias-illustration-backing)" />
      <rect x="42" y="26" width="68" height="86" rx="10" fill="var(--dsw-alias-illustration-surface)" />
      <rect x="54" y="44" width="44" height="6" rx="3" fill="var(--dsw-alias-illustration-detail)" />
      <rect x="54" y="58" width="30" height="6" rx="3" fill="var(--dsw-alias-illustration-detail)" />
      <circle cx="58" cy="82" r="6" fill="var(--dsw-alias-illustration-detail)" />
      <circle cx="74" cy="82" r="6" fill="var(--dsw-alias-illustration-inset)" />
      <circle cx="90" cy="82" r="6" fill="var(--dsw-alias-illustration-inset)" />
      <path d="M110 76C118 76 124 82 124 90V96" stroke="var(--dsw-alias-illustration-detail)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="124" cy="108" r="17" fill="var(--dsw-alias-illustration-backing)" />
      <circle cx="124" cy="108" r="11" fill="var(--dsw-alias-illustration-surface)" />
      <path d="M119.5 108.5L122.5 111.5L129 104.5" stroke="var(--dsw-alias-illustration-detail)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M143.5 132.5C144.9 132.5 146.3 132.6 147.7 132.8V133.2C146.3 133.4 144.9 133.5 143.5 133.5C142.1 133.5 140.7 133.4 139.3 133.2V132.8C140.7 132.6 142.1 132.5 143.5 132.5Z" fill="var(--dsw-alias-illustration-detail)" />
      <path d="M30.5 132.5C31.9 132.5 33.3 132.6 34.7 132.8V133.2C33.3 133.4 31.9 133.5 30.5 133.5C29.1 133.5 27.7 133.4 26.3 133.2V132.8C27.7 132.6 29.1 132.5 30.5 132.5Z" fill="var(--dsw-alias-illustration-detail)" />
      <path d="M25.1057 55.3477C25.1058 51.2974 25.4059 47.2693 26.0026 43.2765H27.2088C27.8055 47.2693 28.1056 51.2974 28.1056 55.3477C28.1056 59.3979 27.8055 63.4261 27.2088 67.4188H26.0026C25.4059 63.4261 25.1058 59.3979 25.1057 55.3477Z" fill="var(--dsw-alias-illustration-detail)" />
      <path d="M16.3477 64.1057C20.3979 64.1058 24.4261 64.4059 28.4188 65.0026V66.2088C24.4261 66.8055 20.3979 67.1056 16.3477 67.1056C12.2974 67.1056 8.26932 66.8055 4.27654 66.2088V65.0026C8.26932 64.4059 12.2974 64.1058 16.3477 64.1057Z" fill="var(--dsw-alias-illustration-detail)" />
    </svg>
  )
}
