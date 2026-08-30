---
name: theia-tree-scroll-snapback
description: Theia's virtualized tree scrolled back to the focused row on every re-render because the Virtuoso ref is an inline arrow; patched in @theia/core
metadata:
  type: reference
---

`TreeWidget.View.render` (`@theia/core/lib/browser/tree/tree-widget.js`) passes `Virtuoso` an **inline arrow** as `ref`. React sees a new function identity on every render, so after each commit it detaches (`ref(null)`) and re-attaches the ref — and the callback called `scrollIntoViewIfNeeded()`, i.e. `list.scrollIntoView({ index: scrollToRow, align: 'center' })`.

Effect: *any* re-render of a tree yanked the viewport back to the focused/selected row, even when `scrollToRow` had not changed. The sibling `componentDidUpdate` guard (`scrollToRow !== prevProps.scrollToRow`) was doing the right thing and was bypassed by the ref path.

The re-renders come from the listeners registered in `TreeWidget.init` — decoration changes, `labelProvider.onDidChange`, `model.onDidUpdate`, and `onResize`. In SPEXR the frequent ones are our own `GitIgnoredDecorationProvider` and `GitStateDecorationProvider`: both are driven by `FileService.onDidFilesChange` and fire their change emitter **without diffing**, so any file churn reached `FileTreeDecoratorAdapter` → `TreeWidget.updateDecorations` → `update()`. Symptom as reported: scrolling the explorer away from the selected file snapped straight back to it.

**Fix:** `patches/@theia__core@1.71.0.patch` removes the `scrollIntoViewIfNeeded()` call from the ref callback only. Mount is still covered by `componentDidMount` (the ref attaches first, so `this.list` is set), later moves by `componentDidUpdate`. Wired through `pnpm.patchedDependencies` in the root `package.json` — pnpm 9 keeps that field in `package.json`, not in `pnpm-workspace.yaml`. Packaged builds must install with patches applied.

Watch on a Theia upgrade: the patch is against compiled `lib/` and will fail to apply if upstream touches that block. Upstream may also fix it — check before re-creating the patch.

Not covered by a test: the change lives in a dependency, and nothing in this repo can exercise it. Verified by hand in the running app (scroll the explorer far from the selection; it stays put).

Related: [[theia-backend-orphans]], [[theia-colors-css-vs-registry]].
