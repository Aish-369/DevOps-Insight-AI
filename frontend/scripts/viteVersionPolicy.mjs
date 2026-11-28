const PATCHED_VITE_FLOOR = [8, 3, 7];
export function isPatchedViteVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/.exec(version ?? "");
  if (!match) return false;
  const parsed = match.slice(1, 4).map(Number);
  for (let i = 0; i < PATCHED_VITE_FLOOR.length; i += 1) {
    if (parsed[i] > PATCHED_VITE_FLOOR[i]) return true;
    if (parsed[i] < PATCHED_VITE_FLOOR[i]) return false;
  }
  return true;
}
