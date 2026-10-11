#!/bin/bash
# spexr command blocks (S6l). Used as bash's --rcfile by SpexrShellIntegrationInjector.
#
# It chains Theia's own integration, which sources the user's rc files and
# Theia's command-block support (OSC 133 prompt and command marks), and adds
# marks of its own, each carrying a nonce:
#
#   OSC 133 ; spexr_prompt   ; <nonce>                         a prompt is about to be drawn
#   OSC 133 ; spexr_started  ; <nonce> ; <epoch ms>            a command starts
#   OSC 133 ; spexr_finished ; <nonce> ; <exit> ; <epoch ms>   it ended
#
# The nonce is made by the backend for this shell alone and told to the
# terminal out of band (an RPC by terminal id); it reaches the shell in
# SPEXR_BLOCK_NONCE, which is read into a shell variable and unset here,
# FIRST, before any rc file of the user's runs, so nothing the rc files print
# or run can learn it and forge a mark. Without it nothing is installed.
#
# Resolution: with EPOCHREALTIME (bash 5) the clock is in milliseconds; without
# it (macOS's bash 3.2) it is whole seconds from `date`, a fork per mark.

__spexr_nonce="${SPEXR_BLOCK_NONCE-}"
builtin unset SPEXR_BLOCK_NONCE

if [ -n "${SPEXR_THEIA_BASH_RCFILE-}" ] && [ -r "$SPEXR_THEIA_BASH_RCFILE" ]; then
  builtin source "$SPEXR_THEIA_BASH_RCFILE"
fi
builtin unset SPEXR_THEIA_BASH_RCFILE

# No nonce, no marks: Theia's integration stays as it is.
if [ -z "${__spexr_nonce-}" ]; then
  builtin return 0 2>/dev/null
fi

__spexr_now_ms() {
  if [[ -n "${EPOCHREALTIME-}" ]]; then
    builtin local t="${EPOCHREALTIME/[.,]/}"
    builtin printf '%s' "$((t / 1000))"
  else
    builtin printf '%s000' "$(builtin command date +%s)"
  fi
}

__spexr_running=""

# Runs first in PROMPT_COMMAND, so $? is still the command's exit status.
# It never returns non-zero: a shell with `set -e` would exit on it.
__spexr_precmd() {
  builtin local __spexr_rc=$?
  if [[ -n "$__spexr_running" ]]; then
    __spexr_running=""
    builtin printf '\e]133;spexr_finished;%s;%s;%s\a' "$__spexr_nonce" "$__spexr_rc" "$(__spexr_now_ms)"
  fi
  builtin printf '\e]133;spexr_prompt;%s\a' "$__spexr_nonce"
  # Hand the status on to the hooks after this one, unless that would trip errexit.
  if [[ $- == *e* ]]; then
    builtin return 0
  fi
  builtin return $__spexr_rc
}

# Wrap Theia's preexec (called from its DEBUG trap) so a started mark goes out
# first. Without Theia's function there is nothing to wrap and no blocks.
if builtin declare -F __theia_command_preexec > /dev/null 2>&1; then
  builtin eval "$(builtin declare -f __theia_command_preexec | builtin command sed '1s/__theia_command_preexec/__spexr_theia_preexec/')"
  __theia_command_preexec() {
    __spexr_running="1"
    builtin printf '\e]133;spexr_started;%s;%s\a' "$__spexr_nonce" "$(__spexr_now_ms)"
    __spexr_theia_preexec "$@"
  }
fi

# `set -u` safe: the variable may not exist, and an array of one entry is a plain string.
if [[ -n "${PROMPT_COMMAND+x}" ]] && [[ ${#PROMPT_COMMAND[@]} -gt 1 ]]; then
  PROMPT_COMMAND=("__spexr_precmd" "${PROMPT_COMMAND[@]}")
else
  PROMPT_COMMAND="__spexr_precmd${PROMPT_COMMAND:+$'\n'$PROMPT_COMMAND}"
fi
