export function isUnauthorizedError(error: Error): boolean {
  return /^401:/.test(error.message) || error.message.includes('Unauthorized');
}

export function handleAuthError(error: Error) {
  if (isUnauthorizedError(error)) {
    // Remove token and redirect to login
    localStorage.removeItem('auth_token');
    window.location.reload();
  }
}