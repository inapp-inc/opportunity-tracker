export const WORKSPACE_LAYOUT_EVENT = "workspace-layout-updated";

export function emitWorkspaceLayoutUpdated(detail?: { page?: string }) {
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_LAYOUT_EVENT, { detail: detail || {} })
  );
}
