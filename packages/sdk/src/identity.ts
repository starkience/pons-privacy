/**
 * Stable, app-scoped message for the official STRK20 key derivation route.
 * Changing it changes derived accounts and can orphan existing positions.
 */
export function createPonsPrivacyIdentityMessage(appId: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{0,62}$/.test(appId)) {
    throw new Error(
      "appId must be a lowercase DNS-style slug of at most 63 characters",
    );
  }
  return [
    "Pons Privacy — derive sanitization keys",
    "Version: 1",
    `Application: ${appId}`,
    "",
    "This signature does not authorize a blockchain transaction or transfer.",
  ].join("\n");
}
