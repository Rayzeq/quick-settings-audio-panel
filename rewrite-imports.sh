#!/usr/bin/env bash

# Exit on any error
set -e

pushd dist/

find . -type f -name "*.js" -print0 | while IFS= read -r -d '' file; do
    dir=$(dirname "$file")
    
    # Compute the relative path from the file's directory to libs/libpanel
    relative_path=$(node -e "const path = require('path'); console.log(path.relative('$dir', 'libs/libpanel'));")

    # Adjust the relative path to ensure it starts with ./ if it doesn't start with ../
    if [[ $relative_path != ../* ]]; then
        # If the path is empty, we're in the same directory, use ./
        if [ -z "$relative_path" ]; then
            replacement="./"
        else
            replacement="./$relative_path/"
        fi
    else
        replacement="$relative_path/"
    fi
    
    # Escape special characters for sed
    escaped_replacement=$(printf '%s\n' "$replacement" | sed -e 's/[\/&]/\\&/g')
    
    # Perform the replacement in the file
    sed -i.bak "s|@libpanel/|$escaped_replacement|g" "$file"
done

# Remove backup files created by sed
find . -name "*.bak" -delete