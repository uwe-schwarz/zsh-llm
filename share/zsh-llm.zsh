# Zsh integration for zsh-llm (OpenAI Responses API helper)
# Usage: bind a key (default Alt-\) to refresh the current buffer with the helper command.

__zsh_llm_apply() {
  local current_buffer=$BUFFER
  local cursor=$CURSOR
  echo
  local result
  if ! result=$(zsh-llm "$current_buffer"); then
    BUFFER=$current_buffer
    CURSOR=$cursor
    zle reset-prompt
    return 1
  fi
  if [[ -n $result ]]; then
    BUFFER=$result
    CURSOR=${#result}
  else
    BUFFER=$current_buffer
    CURSOR=$cursor
  fi
  zle reset-prompt
}

zle -N __zsh_llm_apply

bind_sequence=${ZSH_LLM_BINDKEY:-$'\e\\'}
bindkey "$bind_sequence" __zsh_llm_apply
