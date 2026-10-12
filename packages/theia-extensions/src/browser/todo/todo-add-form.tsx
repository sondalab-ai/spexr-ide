import * as React from "react";

export interface TodoAddFormProps {
  /** Folder names offered as the destination; the picker shows only when there are several. */
  readonly folders: readonly string[];
  readonly target: number;
  readonly onTarget: (index: number) => void;
  /** Resolves true when the item was written, so the draft can be cleared. */
  readonly onAdd: (text: string) => Promise<boolean>;
}

/**
 * The "Add a TODO" form. The draft lives in React state, not in the widget:
 * the widget renders asynchronously, so a value it owned would be re-applied
 * stale between keystrokes and push the caret to the end.
 */
export function TodoAddForm({ folders, target, onTarget, onAdd }: TodoAddFormProps): React.ReactElement {
  const [draft, setDraft] = React.useState("");
  return (
    <form
      className="spexr-todo__add"
      onSubmit={(e) => {
        e.preventDefault();
        void onAdd(draft).then((added) => {
          if (added) setDraft("");
        });
      }}
    >
      {folders.length > 1 && (
        <span className="sl-select">
          <select className="sl-field__input" value={target} aria-label="Add to folder" onChange={(e) => onTarget(Number(e.target.value))}>
            {folders.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
        </span>
      )}
      <div className="spexr-todo__add-row">
        <input className="sl-field__input" value={draft} placeholder="Add a TODO" aria-label="New TODO" onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className="sl-btn sl-btn--sm" disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </form>
  );
}
