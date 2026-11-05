/**
 * Validate every installed component file against its recorded SHA-256 and Desktop target.
 * @param directory Installed component directory.
 * @param target Desktop platform and architecture.
 * @returns Verified version and file count; rejects unsafe, missing, changed or incompatible payloads.
 */
export function verifyWdhComponent(directory: string, target: { platform: string; arch: string }): Promise<{ version: string; filesVerified: number }>
