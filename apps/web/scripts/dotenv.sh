#!/usr/bin/env bash
# Parse dotenv files as data. This file is trusted shell code; dotenv contents
# are never sourced or evaluated. Every well-formed KEY=VALUE assignment is
# exported — there is no allow-list to maintain, so new config vars work without
# editing this file. Malformed lines and invalid variable names still fail
# closed, and the never-export deny-list below keeps local-only browser-test and
# cloud credentials out of the server process.

# These values may live in the ignored developer env for browser-driven tests,
# but they are not API runtime configuration and must never be exported to the
# server process.
readonly -a DOTENV_API_LOCAL_ONLY_KEYS=(
  GOOGLE_OAUTH_TEST_USERNAME
  GOOGLE_OAUTH_TEST_PASSWORD
  AWS_ACCESS_KEY_ID
  AWS_SECRET_ACCESS_KEY
  AWS_SESSION_TOKEN
  AWS_PROFILE
  AWS_REGION
  AWS_DEFAULT_REGION
)

_dotenv_is_local_only_key() {
  local local_only_key
  for local_only_key in "${DOTENV_API_LOCAL_ONLY_KEYS[@]}"; do
    if [[ "$1" == "$local_only_key" ]]; then
      return 0
    fi
  done
  return 1
}

_dotenv_trim_left() {
  DOTENV_RESULT="$1"
  while [[ "$DOTENV_RESULT" == [[:space:]]* ]]; do
    DOTENV_RESULT="${DOTENV_RESULT#?}"
  done
}

_dotenv_trim_right() {
  DOTENV_RESULT="$1"
  while [[ "$DOTENV_RESULT" == *[[:space:]] ]]; do
    DOTENV_RESULT="${DOTENV_RESULT%?}"
  done
}

_dotenv_parse_quoted() {
  local input="$1" quote="$2" output="" character next trailing
  local index=1 length=${#1} closed=0

  while (( index < length )); do
    character="${input:index:1}"
    if [[ "$character" == "$quote" ]]; then
      closed=1
      ((index += 1))
      break
    fi

    if [[ "$quote" == '"' && "$character" == \\ ]]; then
      ((index += 1))
      if (( index >= length )); then
        return 1
      fi
      next="${input:index:1}"
      case "$next" in
        n) output+=$'\n' ;;
        r) output+=$'\r' ;;
        t) output+=$'\t' ;;
        '"'|\\) output+="$next" ;;
        *) output+="\\$next" ;;
      esac
    else
      output+="$character"
    fi
    ((index += 1))
  done

  (( closed == 1 )) || return 1
  trailing="${input:index}"
  _dotenv_trim_left "$trailing"
  trailing="$DOTENV_RESULT"
  if [[ -n "$trailing" && "$trailing" != \#* ]]; then
    return 1
  fi
  DOTENV_RESULT="$output"
}

load_dotenv_file() {
  local env_file="$1" line key value line_number=0

  if [[ ! -f "$env_file" ]]; then
    echo "dotenv: env file not found: $env_file" >&2
    return 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    ((line_number += 1))
    line="${line%$'\r'}"
    _dotenv_trim_left "$line"
    line="$DOTENV_RESULT"
    if [[ -z "$line" || "$line" == \#* ]]; then
      continue
    fi
    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      _dotenv_trim_left "$line"
      line="$DOTENV_RESULT"
    fi
    if [[ "$line" != *=* ]]; then
      echo "dotenv: malformed assignment at line $line_number" >&2
      return 1
    fi

    key="${line%%=*}"
    _dotenv_trim_right "$key"
    key="$DOTENV_RESULT"
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "dotenv: invalid variable name at line $line_number" >&2
      return 1
    fi
    if _dotenv_is_local_only_key "$key"; then
      continue
    fi

    value="${line#*=}"
    _dotenv_trim_left "$value"
    value="$DOTENV_RESULT"
    case "${value:0:1}" in
      "'"|'"')
        if ! _dotenv_parse_quoted "$value" "${value:0:1}"; then
          echo "dotenv: malformed quoted value for $key at line $line_number" >&2
          return 1
        fi
        value="$DOTENV_RESULT"
        ;;
      *)
        value="${value%%#*}"
        _dotenv_trim_right "$value"
        value="$DOTENV_RESULT"
        ;;
    esac
    export "$key=$value"
  done < "$env_file"
}

require_env_vars() {
  local name value
  for name in "$@"; do
    value="${!name-}"
    if [[ -z "$value" || "$value" =~ ^[[:space:]]*$ ]]; then
      echo "dotenv: required variable $name is missing or empty" >&2
      return 1
    fi
  done
}

# Print the variable names an env file defines (one per line), so callers can
# clear exactly those keys for a hermetic start without maintaining a static
# list. Skips comments, blanks, and malformed/invalid names.
dotenv_file_keys() {
  local env_file="$1" line key
  [[ -f "$env_file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    _dotenv_trim_left "$line"
    line="$DOTENV_RESULT"
    if [[ -z "$line" || "$line" == \#* ]]; then
      continue
    fi
    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      _dotenv_trim_left "$line"
      line="$DOTENV_RESULT"
    fi
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    _dotenv_trim_right "$key"
    key="$DOTENV_RESULT"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    printf '%s\n' "$key"
  done < "$env_file"
}
