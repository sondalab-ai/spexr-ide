# spexr (S6l): the dot files Theia's ZDOTDIR holds source the user's own through
# "$THEIA_ZSH_DIR/zdotdir/source-original.zsh", and THEIA_ZSH_DIR points at
# spexr's directory (where zsh-integration.zsh is).
#
# 1. On its first call (from .zshenv, before any file of the user's) it takes
#    the nonce out of the environment into a shell variable and unsets it, so
#    nothing the user's rc files print or run can learn it (see
#    bash/spexr-bash-integration.bash for what the nonce is).
# 2. It hands over to Theia's own helper, which does the work in this same
#    (global) scope.
if [[ -z "${__spexr_nonce+x}" ]]; then
  typeset -g __spexr_nonce="${SPEXR_BLOCK_NONCE-}"
  builtin unset SPEXR_BLOCK_NONCE
fi
if [[ -n "${SPEXR_THEIA_ZSH_DIR-}" && -r "${SPEXR_THEIA_ZSH_DIR}/zdotdir/source-original.zsh" ]]; then
  builtin source "${SPEXR_THEIA_ZSH_DIR}/zdotdir/source-original.zsh"
fi
