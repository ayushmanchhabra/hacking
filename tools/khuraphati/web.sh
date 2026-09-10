#!/bin/bash

echo -e "Legal disclaimer: Usage of khuraphati scripts on hosts without prior mutual consent is illegal. It is the end user's responsibility to obey all applicable local, state and federal laws. Developers assume no liability and are not responsible for any misuse or damage caused by this program.\n"

# Perform directory traversal on target host.
function fuzz_paths () {
    # Host name
    HOST_NAME=$1
    # File path to word list
    WORD_LIST_PATH=$2
    # Remove the first / from each word in word list
    sed -i 's|^/||' "$WORD_LIST_PATH"
	# Split file contents by \n and store in array
	mapfile -t WORD_LIST < "$WORD_LIST_PATH"
	# Iterate over word list array and return status code with URL redirects
	for WORD in "${WORD_LIST[@]}"; do
		CURL_OUTPUT=$( curl -s -o /dev/null -w "%{http_code} %{url_effective} --> %{redirect_url}" -L "$HOST_NAME/$WORD" )
		echo -e "$CURL_OUTPUT $HOST_NAME/$WORD \n"
	done
}

if [[ "$1" == 'help' ]]; then
    echo -e "web.sh <command>\n"
    echo -e "Usage:\n"
    echo "./web.sh help ..Get information on how to use this script"
    echo "./web.sh fuzz ..Perform different types of fuzzing on target host"
    exit 0
elif [[ "$1" == "fuzz" ]]; then
    echo -e "web.sh <command>\n"
    echo -e "Usage:\n"
    echo "./web.sh fuzz=directory http(s)://host.tld /path/to/wordlist/text/file ..Perform path traversal on target host"
elif [[ "$1" == "fuzz=directory" ]]; then
    fuzz_paths "$2" "$3" "$4"
else
    echo "Unknown command. Please consult the 'help' command for guidance."
fi
