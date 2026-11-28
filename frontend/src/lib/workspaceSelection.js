const STORAGE_PREFIX = "devops-insight-ai:active-workspace:";

function getStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readActiveWorkspaceId(userId) {
  if (!userId) return null;
  try {
    return getStorage()?.getItem(STORAGE_PREFIX + userId) ?? null;
  } catch {
    return null;
  }
}

export function saveActiveWorkspaceId(userId, workspaceId) {
  if (!userId) return;
  try {
    const storage = getStorage();
    if (!storage) return;
    const key = STORAGE_PREFIX + userId;
    if (workspaceId) storage.setItem(key, workspaceId);
    else storage.removeItem(key);
  } catch {
    // Workspace selection is a convenience; blocked storage must not break the app.
  }
}

export function resolveActiveWorkspaceId(userId, preferredId, workspaces) {
  const availableIds = new Set(workspaces.map((workspace) => workspace.id));
  if (preferredId && availableIds.has(preferredId)) return preferredId;

  const storedId = readActiveWorkspaceId(userId);
  if (storedId && availableIds.has(storedId)) return storedId;

  return workspaces[0]?.id ?? null;
}
