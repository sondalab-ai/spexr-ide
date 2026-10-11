#!/bin/bash
# spexr command blocks (S6l). Used as bash's --rcfile by SpexrShellIntegrationInjector.
#
# It chains Theia's own integration, which sources the user's rc files and
# Theia's command-block support (OSC 133 prompt and command marks), and then
# adds one sequence of its own after each command:
#
#   OSC 133 ; spexr_finished ; <nonce> ; <exit code> ; <epoch ms> BEL
#
# and, once at start-up before any command can run, the nonce itself:
#
#   OSC 133 ; spexr_hello ; <nonce> BEL
#
# The nonce is a shell variable, never exported, so what a command prints (a
# `cat` of a hostile file) cannot forge a block: the terminal accepts a
# finished mark only with the nonce it was told at start-up.

if [ -n "${SPEXR_THEIA_BASH_RCFILE-}" ] && [ -r "$SPEXR_THEIA_BASH_RCFILE" ]; then
  builtin source "$SPEXR_THEIA_BASH_RCFILE"
fi
builtin unset SPEXR_THEIA_BASH_RCFILE

__spexr_now_ms() {
  if [[ -n "${EPOCHREALTIME-}" ]]; then
    builtin local t="${EPOCHREALTIME/[.,]/}"
    builtin printf '%s' "$((t / 1000))"
  else
    builtin printf '%s000' "$(builtin command date +%s)"
  fi
}

__spexr_make_nonce() {
  builtin local n
  if builtin command -v od > /dev/null && builtin command -v tr > /dev/null && [ -r /dev/urandom ]; then
    n="$(builtin command od -An -N16 -tx1 /dev/urandom | builtin command tr -d ' \n')"
  fi
  if [ "${#n}" -ne 32 ]; then
    n="$(builtin printf '%08x%08x%08x%08x' "$RANDOM$RANDOM" "$RANDOM$RANDOM" "$RANDOM$RANDOM" "$RANDOM$RANDOM")"
    n="${n:0:32}"
  fi
  builtin printf '%s' "$n"
}

__spexr_nonce="$(__spexr_make_nonce)"
__spexr_hello=""

# Runs first in PROMPT_COMMAND, so $? is still the command's exit status.
# Theia's precmd clears __theia_command_running after this one has looked.
__spexr_precmd() {
  builtin local __spexr_rc=$?
  if [[ -z "$__spexr_hello" ]]; then
    __spexr_hello="1"
    builtin printf '\e]133;spexr_hello;%s\a' "$__spexr_nonce"
  elif [[ -n "${__theia_command_running-}" ]]; then
    builtin printf '\e]133;spexr_finished;%s;%s;%s\a' "$__spexr_nonce" "$__spexr_rc" "$(__spexr_now_ms)"
  fi
  return $__spexr_rc
}

if [[ ${#PROMPT_COMMAND[@]} -gt 1 ]]; then
  PROMPT_COMMAND=("__spexr_precmd" "${PROMPT_COMMAND[@]}")
else
  PROMPT_COMMAND="__spexr_precmd${PROMPT_COMMAND:+$'\n'$PROMPT_COMMAND}"
fi
