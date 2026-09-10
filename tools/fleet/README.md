# Fleet

An automation/orchestration tool for system administrators, security engineers, pen testers and related roles. This tool is similar to Ansible in spirit (while taking a shell scripting first approach) and aims to be as configurable as Metasploit.

## Getting Started

This script (`fleet.sh`) logs into specific IPs defined in a text file (`hosts.txt`) and executes a user defined task (for example, `./tasks/info/os_name_version.sh`). Note that the same credentials are used to log into multiple hosts.

## Prerequisites

1. Source and destination hosts are Linux.
1. Bash, nmap, ssh and sshpass are installed.

## Usage

1. Git clone this repo: `git clone https://github.com/ayushmanchhabra/fleet`
1. Hop into the folder: `cd ./fleet`
1. Set your password: `export SSHPASS=secret_password`
1. Execute the script: `bash ./fleet.sh host_username ./hosts.csv ./tasks/info/os_name_version.sh`
1. Unset your password: `unset SSHPASS`

## Scenarios

1. Pentester: Check if credentials are valid before doing OS scanning.
1. Security engineer: Check how many IPs are using a vulnerable version of a specific package or packages.
1. System administrator: Filter out ICMP timestamp requests and responses on many IPs using `iptables`.

## Limitations

1. Only supports password based authentication.

## License

MIT.

> Legal disclaimer: Usage of fleet on hosts without prior mutual consent is illegal. It is the end user's responsibility to obey all applicable local, state and federal laws. Developers assume no liability and are not responsible for any misuse or damage caused by this program.
