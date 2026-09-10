#!/bin/bash

echo "Legal disclaimer: Usage of fleet on hosts without prior mutual consent is illegal. It is the end user's responsibility to obey all applicable local, state and federal laws. Developers assume no liability and are not responsible for any misuse or damage caused by this program."

USERNAME="$1"
HOST_FILE="$2"
TASK_FILE="$3"

if [[ ! -f "$HOST_FILE" ]]; then
    echo "Error: Host file $HOST_FILE not found.."
    exit 1
fi

if [[ ! -f "$TASK_FILE" ]]; then
    echo "Error: Task file $TASK_FILE not found.."
    exit 1
fi

declare -A array
readarray -t lines < <(tail -n +2 "$HOST_FILE")

for i in "${!lines[@]}"; do
    IFS=',' read -r host status output <<< "${lines[i]}"
    array["$i,0"]="$host"
    array["$i,1"]="$status"
    array["$i,2"]="$output"
done

for ((i=0; i<${#lines[@]}; i++)); do
    if nmap -p 22 "${array[$i,0]}" | grep -q "open"; then
        array["$i,1"]="Login success"
    else
        array["$i,1"]="Login failure"
        array["$i,2"]="Host is down or port 22 is not open"
        continue
    fi
    ssh_output=$(sshpass -e ssh "$USERNAME@${array[$i,0]}" 'bash -s' < "$TASK_FILE" 2>&1)

    if [[ $? -eq 0 ]]; then
        array["$i,1"]="login success"
    else
        array["$i,1"]="login failure"
    fi

    array["$i,2"]="$ssh_output"
done

{
    echo "Host,Status,Output"

    for ((i=0; i<${#lines[@]}; i++)); do
        # Construct each line from the associative array
        echo "${array[$i,0]},${array[$i,1]},${array[$i,2]}"
    done
} > "$HOST_FILE"

echo -e "\nTask has been run on hosts and output has been saved in host file $HOST_FILE"
