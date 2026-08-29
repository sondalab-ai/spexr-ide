export type SpecPreviewAction = "open" | "close" | "none";

export interface SpecPreviewState {
  /** URI of the spec editor in front of the main area; absent for anything else. */
  readonly frontSpecUri?: string;
  /** Whether the preview widget is currently attached to the shell. */
  readonly attached: boolean;
  /** Whether a spec editor is still open anywhere in the main area. */
  readonly anySpecOpen: boolean;
  /** The user's last explicit open/close intent for the preview. */
  readonly wantOpen: boolean;
  /** Spec the user last closed the preview on, if any. */
  readonly closedForUri?: string;
}

/**
 * Decide what the spec markdown preview should do for the current shell state.
 *
 * The preview mirrors a spec editor, so it outlives one only while another is
 * still open. That includes the case where the preview is itself the widget in
 * front: closing the last spec leaves its split empty and hands the preview the
 * front position, which must not be read as a reason to keep it around.
 */
export function decideSpecPreview(state: SpecPreviewState): SpecPreviewAction {
  const { frontSpecUri, attached, anySpecOpen, wantOpen, closedForUri } = state;

  if (frontSpecUri !== undefined) {
    if (attached) return "none";
    return wantOpen || frontSpecUri !== closedForUri ? "open" : "none";
  }

  return attached && !anySpecOpen ? "close" : "none";
}
