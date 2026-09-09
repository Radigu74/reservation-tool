export function usesUniversalBookingStagingProject(hostname) {
  return String(hostname || '').toLowerCase().includes('git-feature-univers')
}
