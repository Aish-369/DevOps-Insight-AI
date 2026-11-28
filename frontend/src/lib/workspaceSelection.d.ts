export type WorkspaceOption = { id: string };

export function readActiveWorkspaceId(userId: string): string | null;
export function saveActiveWorkspaceId(userId: string, workspaceId: string | null): void;
export function resolveActiveWorkspaceId(
  userId: string,
  preferredId: string,
  workspaces: readonly WorkspaceOption[],
): string | null;
