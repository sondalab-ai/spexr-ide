# spexr command blocks (S6l). Sourced by Theia's .zshrc (through THEIA_ZSH_DIR,
# which SpexrShellIntegrationInjector points here) after the user's own rc files.
#
# It chains Theia's integration (OSC 133 prompt and command marks), then adds
# marks of its own, each with the nonce zdotdir/source-original.zsh took out of
# the environment before any of the user's files ran:
#
#   OSC 133 ; spexr_prompt   ; <nonce>                         a prompt is about to be drawn
#   OSC 133 ; spexr_started  ; <nonce> ; <epoch ms>            a command starts
#   OSC 133 ; spexr_finished ; <nonce> ; <exit> ; <epoch ms>   it ended
#
# Without a nonce nothing is installed. Powerlevel10k (P9K_VERSION) is left
# alone, as Theia's own script leaves it: its prompt pipeline breaks external
# OSC 133 marks, so there are no blocks under it.

if [[ -n "${SPEXR_THEIA_ZSH_DIR-}" && -r "${SPEXR_THEIA_ZSH_DIR}/zsh-integration.zsh" ]]; then
  THEIA_ZSH_DIR="$SPEXR_THEIA_ZSH_DIR"
  builtin source "${SPEXR_THEIA_ZSH_DIR}/zsh-integration.zsh"
fi
builtin unset SPEXR_THEIA_ZSH_DIR

[[ -z "${__spexr_nonce-}" ]] && builtin return 0
[[ -n "${P9K_VERSION-}" ]] && builtin return 0

builtin zmodload zsh/datetime 2>/dev/null

# Milliseconds with EPOCHREALTIME (zsh/datetime); else whole seconds from `date`, a fork per mark.
__spexr_now_ms() {
  if [[ -n "${EPOCHREALTIME-}" ]]; then
    builtin printf '%.0f' $(( EPOCHREALTIME * 1000 ))
  else
    builtin printf '%s000' "$(builtin command date +%s)"
  fi
}

__spexr_running=""

__spexr_preexec() {
  __spexr_running="1"
  builtin printf '\e]133;spexr_started;%s;%s\a' "$__spexr_nonce" "$(__spexr_now_ms)"
}

# First in precmd_functions, so $? is still the command's exit status.
# It never returns non-zero under errexit / err_return.
__spexr_precmd() {
  builtin local __spexr_rc=$?
  if [[ -n "$__spexr_running" ]]; then
    __spexr_running=""
    builtin printf '\e]133;spexr_finished;%s;%s;%s\a' "$__spexr_nonce" "$__spexr_rc" "$(__spexr_now_ms)"
  fi
  builtin printf '\e]133;spexr_prompt;%s\a' "$__spexr_nonce"
  if [[ -o errexit || -o err_return ]]; then
    builtin return 0
  fi
  builtin return $__spexr_rc
}

builtin autoload -Uz add-zsh-hook
add-zsh-hook preexec __spexr_preexec
precmd_functions=(__spexr_precmd ${precmd_functions:#__spexr_precmd})
