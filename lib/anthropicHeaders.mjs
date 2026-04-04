export const ANTHROPIC_OAUTH_BETA = 'oauth-2025-04-20'

export function subscriptionStyleHeaders(bearerSecret) {
  return {
    Authorization: `Bearer ${bearerSecret}`,
    'anthropic-beta': ANTHROPIC_OAUTH_BETA,
  }
}
