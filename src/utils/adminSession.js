// Admin edit-session helpers. The password the admin types is kept only in
// sessionStorage (this tab, this session) so it can sign each write RPC.
// It is never stored in the code or the build. Cleared on logout / tab close.
const KEY = 'spi_admin_pw'

export function getAdminPassword() {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setAdminPassword(pw) {
  try {
    sessionStorage.setItem(KEY, pw)
  } catch {
    /* storage unavailable — session just won't persist across reloads */
  }
}

export function clearAdminPassword() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
