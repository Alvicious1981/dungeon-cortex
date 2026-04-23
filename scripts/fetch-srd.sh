#!/bin/bash
# Fetch D&D 5.1 SRD in Markdown format from a verified 2014 CC-BY-4.0 source
# Source: https://github.com/oldmanumby/DND.SRD.Wiki.git

set -e

echo "Starting SRD 5.1 download..."

# Create the target directory if it doesn't exist
TARGET_DIR="docs/reference/srd"
mkdir -p "$TARGET_DIR"

# Create a temporary directory for cloning
TEMP_DIR=$(mktemp -d)
echo "Cloning into temporary directory $TEMP_DIR..."

# Clone the repository (depth 1 to save time/bandwidth)
git clone --depth 1 https://github.com/oldmanumby/DND.SRD.Wiki.git "$TEMP_DIR"

# Verify we got what we expect (README should mention v5.1)
if grep -q "v5.1" "$TEMP_DIR/README.md"; then
  echo "Verification successful: Confirmed SRD v5.1."
else
  echo "Verification failed: Could not confirm SRD v5.1."
  rm -rf "$TEMP_DIR"
  exit 1
fi

# Copy core folders to the target directory
echo "Copying core folders (Spells, Monsters, Combat rules)..."

# Ensure target subdirectories exist
mkdir -p "$TARGET_DIR/Spells"
mkdir -p "$TARGET_DIR/Monsters"
mkdir -p "$TARGET_DIR/Combat"

# Copy files
cp -r "$TEMP_DIR/Spells/"* "$TARGET_DIR/Spells/"
cp -r "$TEMP_DIR/Monsters/"* "$TARGET_DIR/Monsters/"

# The Combat rules in this repo are under Gameplay. We'll extract Combat.md
cp "$TEMP_DIR/Gameplay/Combat.md" "$TARGET_DIR/Combat/"
cp "$TEMP_DIR/Gameplay/Adventuring.md" "$TARGET_DIR/Combat/" 2>/dev/null || true

# Cleanup
echo "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"

echo "Done! SRD 5.1 data has been downloaded to $TARGET_DIR."
