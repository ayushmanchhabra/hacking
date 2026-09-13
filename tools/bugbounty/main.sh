#!/bin/bash
#
# Usage: ./main.sh <domain> <output directory>
#
# Requires: awk

set -euo pipefail

usage() {
  echo "Usage: $0 <domain|target> <output_dir>" >&2
}

if [ "$#" -ne 2 ]; then
  usage
  exit 1
fi

input_target="${1}"
output_dir="${2}"

if [ -z "$input_target" ] || [ -z "$output_dir" ]; then
  usage
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p -- "$output_dir"

"$script_dir/src/sub.sh" "$input_target" "$output_dir/sub.txt"
"$script_dir/src/dns.sh" "$output_dir/sub.txt" "$output_dir/dns.csv"
"$script_dir/src/crt.sh" "$output_dir/sub.txt" "$output_dir/tls.csv"
"$script_dir/src/ipdr.sh" "$output_dir/dns.csv" "$output_dir/ipdr.csv"
sudo "$script_dir/src/port.sh" "$output_dir/dns.csv" "$output_dir/port.csv"
"$script_dir/src/srv.sh" "$output_dir/dns.csv" "$output_dir/srv.csv"
