/**
 * A readable version of the checkout failures the user can act on, or undefined
 * to leave git's own message alone.
 *
 * A dirty working tree is deliberately not pre-checked: git carries uncommitted
 * changes across branches whenever they do not collide, and refusing every
 * dirty checkout would block the common case to explain the rare one. The
 * translation happens on the failure instead.
 */
export function explainCheckoutFailure(message: string): string | undefined {
  if (/would be overwritten by (checkout|merge)/i.test(message)) {
    return "Checkout blocked — the target branch changes files you have uncommitted edits in. Commit or stash them first.";
  }
  if (/resolve your current index first|you need to resolve/i.test(message)) {
    return "Checkout blocked — conclude or abort the merge in progress first.";
  }
  return undefined;
}
