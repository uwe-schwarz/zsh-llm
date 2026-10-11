# Zsh input-buffer assistant; loading this file starts no helper process.
# Usage: bind a key (default Alt-\) to refresh the current buffer with the helper command.

__zsh_llm_apply() {
  local current_buffer=$BUFFER
  [[ -n ${current_buffer//[[:space:]]/} ]] || return 0
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

bindkey -M emacs "${ZSH_LLM_BINDKEY:-$'\e\\'}" __zsh_llm_apply
bindkey -M viins "${ZSH_LLM_BINDKEY:-$'\e\\'}" __zsh_llm_apply
