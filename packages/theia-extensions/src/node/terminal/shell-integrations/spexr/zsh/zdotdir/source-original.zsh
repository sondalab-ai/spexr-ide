# spexr (S6l): the dot files Theia's ZDOTDIR holds source the user's own through
# "$THEIA_ZSH_DIR/zdotdir/source-original.zsh", and THEIA_ZSH_DIR points at
# spexr's directory (where zsh-integration.zsh is). This hands over to Theia's
# own helper, which does the work in this same (global) scope.
if [[ -n "${SPEXR_THEIA_ZSH_DIR-}" && -r "${SPEXR_THEIA_ZSH_DIR}/zdotdir/source-original.zsh" ]]; then
  builtin source "${SPEXR_THEIA_ZSH_DIR}/zdotdir/source-original.zsh"
fi
