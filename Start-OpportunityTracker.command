#!/usr/bin/env bash
# Double-click from Finder → runs launcher in Terminal (ensure this file is executable: chmod +x)

cd "$(dirname "$0")" || exit 1
exec bash ./Start-OpportunityTracker.sh
