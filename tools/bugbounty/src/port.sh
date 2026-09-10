#!/bin/bash
#
# Usage: ./port.sh <ip|ips.txt> <output.csv>
#        KILLCHAIN_BIN=/path/to/killchain ./port.sh ips.txt out.csv
#
# Runs the killchain SYN scanner against each IP and writes the open
# ports as a comma-separated list per host. Requires root (killchain
# needs raw sockets) and a built killchain binary (`cd ../../killchain
# && make`).

if [ -z "$2" ]; then
  echo "Usage: $0 <ip|ips.txt> <output.csv>" >&2
  exit 1
fi

if [[ "$2" != *.csv ]]; then
  echo "Error: output file must have a .csv extension" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: killchain needs raw sockets, rerun this script as root/sudo." >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
killchain_bin="${KILLCHAIN_BIN:-$script_dir/../../killchain/out/bin/killchain}"

if [ ! -x "$killchain_bin" ]; then
  echo "Error: killchain binary not found at $killchain_bin" >&2
  echo "Build it first: (cd $script_dir/../../killchain && make)" >&2
  exit 1
fi

# Fail loudly if $1 looks like a file path but doesn't exist
if [[ "$1" == *.txt || "$1" == *.csv || "$1" == *.list || "$1" == */* ]] && [ ! -f "$1" ]; then
  echo "Error: file not found: $1" >&2
  exit 1
fi

if [ -f "$1" ]; then
  echo "Reading IPs from file: $1" >&2
  mapfile -t ips < <(tr -d '\r' < "$1" | grep -v '^[[:space:]]*$')
  echo "Loaded ${#ips[@]} IP(s)" >&2
  if [ "${#ips[@]}" -eq 0 ]; then
    echo "Error: no IPs found in $1" >&2
    exit 1
  fi
else
  echo "Treating input as a single IP: $1" >&2
  ips=("$1")
fi

tmp_csv=$(mktemp)
trap 'rm -f "$tmp_csv"' EXIT

{
  echo "IP,PORTS"

  for ip in "${ips[@]}"; do
    echo "Scanning $ip..." >&2
    : > "$tmp_csv"
    printf 'y\nn\ny\n' | "$killchain_bin" "$ip" "$tmp_csv" >/dev/null 2>&1

    ports=$(grep '^port,' "$tmp_csv" | awk -F',' '{print $3}' | sort -nu | paste -sd, -)

    if [ -n "$ports" ]; then
      echo "$ip,\"$ports\""
    else
      echo "$ip,NA"
    fi
  done
} > "$2"

{ head -n 1 "$2"; tail -n +2 "$2" | sort -u; } > "$2.tmp" && mv "$2.tmp" "$2"

echo
echo "Port scan results written to $2"
echo
