# spexr command blocks (S6l). Sourced by Theia's .zshrc (through THEIA_ZSH_DIR,
# which SpexrShellIntegrationInjector points here) after the user's own rc files.
#
# It chains Theia's integration (OSC 133 prompt and command marks), then adds
#
#   OSC 133 ; spexr_hello ; <nonce> BEL                          once, at start-up
#   OSC 133 ; spexr_finished ; <nonce> ; <exit> ; <epoch ms> BEL after each command
#
# The nonce is a shell variable, never exported, so what a command prints cannot forge a block.

if [[ -n "${SPEXR_THEIA_ZSH_DIR-}" && -r "${SPEXR_THEIA_ZSH_DIR}/zsh-integration.zsh" ]]; then
  THEIA_ZSH_DIR="$SPEXR_THEIA_ZSH_DIR"
  builtin source "${SPEXR_THEIA_ZSH_DIR}/zsh-integration.zsh"
fi
builtin unset SPEXR_THEIA_ZSH_DIR

builtin zmodload zsh/datetime 2>/dev/null

__spexr_now_ms() {
  if [[ -n "${EPOCHREALTIME-}" ]]; then
    builtin printf '%.0f' $(( EPOCHREALTIME * 1000 ))
  else
    builtin printf '%s000' "$(builtin command date +%s)"
  fi
}

__spexr_make_nonce() {
  builtin local n
  if builtin whence od > /dev/null && builtin whence tr > /dev/null && [[ -r /dev/urandom ]]; then
    n="$(builtin command od -An -N16 -tx1 /dev/urandom | builtin command tr -d ' \n')"
  fi
  if (( ${#n} != 32 )); then
    n="$(builtin printf '%08x%08x%08x%08x' "$RANDOM$RANDOM" "$RANDOM$RANDOM" "$RANDOM$RANDOM" "$RANDOM$RANDOM")"
    n="${n[1,32]}"
  fi
  builtin printf '%s' "$n"
}

__spexr_nonce="$(__spexr_make_nonce)"
__spexr_hello=""

# First in precmd_functions, so $? is still the command's exit status; Theia's
# precmd clears __theia_command_running after this one has looked.
__spexr_precmd() {
  builtin local __spexr_rc=$?
  if [[ -z "$__spexr_hello" ]]; then
    __spexr_hello="1"
    builtin printf '\e]133;spexr_hello;%s\a' "$__spexr_nonce"
  elif [[ -n "${__theia_command_running-}" ]]; then
    builtin printf '\e]133;spexr_finished;%s;%s;%s\a' "$__spexr_nonce" "$__spexr_rc" "$(__spexr_now_ms)"
  fi
  builtin return $__spexr_rc
}

precmd_functions=(__spexr_precmd ${precmd_functions:#__spexr_precmd})
