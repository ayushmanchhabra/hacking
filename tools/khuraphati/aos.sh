#!/bin/bash

echo -e "Legal disclaimer: Usage of khuraphati scripts on hosts without prior mutual consent is illegal. It is the end user's responsibility to obey all applicable local, state and federal laws. Developers assume no liability and are not responsible for any misuse or damage caused by this program.\n"


# Extract APKs from Android device using Android Debug Bridge (adb).
function extract_apk () {
    # Package name of target APK(s)
    PKG_NAME=$1
    # Directory in which to extract target APK(s)
    OUT_DIR=$2
    # File path to Android Debug Bridge (adb) binary
    ADB_EXEC=$3
    # Store output of adb command in a variable
    PKG_PATH=$( "$ADB_EXEC" shell pm path "$PKG_NAME" | sed 's/package://g' | tr -d '\r' )
    # Sort the output by \n and store in array
    mapfile -t PKG_PATHS <<< "$PKG_PATH"
    # Extract APK(s) into OUT_DIR directory.
    for PATH in "${PKG_PATHS[@]}"; do
	    "$ADB_EXEC" pull "$PATH" "$OUT_DIR"
    done
}

if [[ "$1" == 'help' ]]; then
    echo -e "aos.sh <command>\n"
    echo -e "Usage:\n"
    echo "./aos.sh help ..Get information on how to use this script"
    echo "./aos.sh extract ..Extract files from Android device using Android Debug Bridge (adb)"
    exit 0
elif [[ "$1" == "extract" ]]; then
    echo -e "aos.sh <command>\n"
    echo -e "Usage:\n"
    echo "./aos.sh extract=apk com.package.name /path/to/outDir /path/to/adb/exe ..Extract APK(s) from Android device using Android Debug Bridge (adb)"
elif [[ "$1" == "extract=apk" ]]; then
    extract_apk "$2" "$3" "$4"
else
    echo "Unknown command. Please consult the 'help' command for guidance."
fi
