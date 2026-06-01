import type { TaskConfig } from './config.js';

export function getCompletionSuggestions(config: TaskConfig, context: string, prefix: string): string[] {
  const normalizedPrefix = prefix.toLowerCase();
  const suggest = (values: string[]): string[] =>
    values
      .filter((value) => value.toLowerCase().startsWith(normalizedPrefix))
      .sort((left, right) => left.localeCompare(right));

  switch (context) {
    case 'view-name':
      return suggest(Object.keys(config.views));
    case 'view-rm':
    case 'list-view':
    case 'count-view':
      return suggest(Object.keys(config.views));
    default:
      return [];
  }
}

export function buildBashCompletionScript(): string {
  return [
    '_task_completion() {',
    '  local context=""',
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    '  local prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '  local command="${COMP_WORDS[1]-}"',
    '  local subcommand="${COMP_WORDS[2]-}"',
    '',
    '  if [[ $COMP_CWORD -eq 1 ]]; then',
    '    mapfile -t COMPREPLY < <(compgen -W "new list ls count view show update validate search" -- "$cur")',
    '    return 0',
    '  fi',
    '',
    '  if [[ "$command" == "view" && $COMP_CWORD -eq 2 ]]; then',
    '    context="view-name"',
    '  elif [[ "$command" == "count" && $COMP_CWORD -eq 2 ]]; then',
    '    context="count-view"',
    '  elif [[ "$command" == "view" && "$subcommand" == "rm" && $COMP_CWORD -eq 3 ]]; then',
    '    context="view-name"',
    '  elif [[ ( "$command" == "list" || "$command" == "ls" ) && "$prev" == "--view" ]]; then',
    '    context="list-view"',
    '  fi',
    '',
    '  if [[ -n "$context" ]]; then',
    '    mapfile -t COMPREPLY < <(task __complete "$context" "$cur")',
    '    return 0',
    '  fi',
    '}',
    '',
    'complete -F _task_completion task',
    ''
  ].join('\n');
}

export function buildFishCompletionScript(): string {
  return [
    'function __task_complete_views',
    '    set -l prefix (commandline -ct)',
    '    task __complete view-name $prefix',
    'end',
    '',
    'function __task_complete_list_view',
    '    set -l prefix (commandline -ct)',
    '    task __complete list-view $prefix',
    'end',
    '',
    'function __task_needs_list_view_completion',
    '    set -l tokens (commandline -opc)',
    '    for token in $tokens',
    '        if test "$token" = "--view"',
    '            return 0',
    '        end',
    '    end',
    '    return 1',
    'end',
    '',
    'complete -c task -n "__fish_use_subcommand" -f -a "new list ls count view show update validate search"',
    'complete -c task -n "__fish_seen_subcommand_from count" -f -a "(__task_complete_views)"',
    'complete -c task -n "__fish_seen_subcommand_from view" -f -a "(__task_complete_views)"',
    'complete -c task -n "__task_needs_list_view_completion" -f -a "(__task_complete_list_view)"',
    ''
  ].join('\n');
}

export function buildZshCompletionScript(): string {
  return [
    '#compdef task',
    '',
    '_task() {',
    '  local -a commands views',
    '  local view_index',
    '  commands=(new list ls count view show update validate search)',
    '',
    '  if (( CURRENT == 2 )); then',
    '    compadd -- $commands',
    '    return',
    '  fi',
    '',
    '  case ${words[2]} in',
    '    view)',
    '      if (( CURRENT == 3 )); then',
    '        _task_complete_views',
    '        return',
    '      fi',
    '      if [[ ${words[3]} == rm ]] && (( CURRENT == 4 )); then',
    '        _task_complete_views',
    '        return',
    '      fi',
    '      ;;',
    '    count)',
    '      if (( CURRENT == 3 )); then',
    '        _task_complete_views',
    '        return',
    '      fi',
    '      ;;',
    '    list|ls)',
    '      view_index=${words[(I)--view]}',
    '      if (( view_index > 0 && CURRENT == view_index + 1 )); then',
    '        _task_complete_views',
    '        return',
    '      fi',
    '      ;;',
    '  esac',
    '}',
    '',
    '_task_complete_views() {',
    '  local -a views',
    '  views=("${(@f)$(task __complete view-name "${words[CURRENT]}")}")',
    '  compadd -- $views',
    '}',
    '',
    'compdef _task task',
    ''
  ].join('\n');
}
