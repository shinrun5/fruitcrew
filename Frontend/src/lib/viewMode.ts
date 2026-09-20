// Which chrome a manager/owner currently wants for pages shared with employees
// (Chat, Notes, Closing) — set whenever they land in either layout, so
// following one of those links from either side keeps matching chrome
// instead of snapping back based on role. Irrelevant for plain employees,
// who always get EmployeeLayout regardless.
const KEY = 'fruitcrew.viewMode'
export type ViewMode = 'work' | 'manage'

export function getViewMode(): ViewMode {
  try {
    return localStorage.getItem(KEY) === 'work' ? 'work' : 'manage'
  } catch {
    return 'manage'
  }
}

export function setViewMode(mode: ViewMode) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // ignore — private mode / storage disabled
  }
}
