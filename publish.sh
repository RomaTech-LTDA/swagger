#!/bin/bash

# ============================================================================
# @romatech/swagger — Publish Script
#
# Usage:
#   ./publish.sh          → publishes current version
#   ./publish.sh patch    → bumps patch (1.0.0 → 1.0.1) and publishes
#   ./publish.sh minor    → bumps minor (1.0.0 → 1.1.0) and publishes
#   ./publish.sh major    → bumps major (1.0.0 → 2.0.0) and publishes
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}  @romatech/swagger — Publish Pipeline${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# --- Step 1: Check prerequisites ---
echo -e "${GREEN}[1/6]${NC} Checking prerequisites..."

if ! command -v npm &> /dev/null; then
  echo -e "${RED}✗ npm is not installed${NC}"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ node is not installed${NC}"
  exit 1
fi

# Check npm auth
if ! npm whoami &> /dev/null; then
  echo -e "${RED}✗ Not logged in to npm. Run: npm login --scope=@romatech${NC}"
  exit 1
fi

NPM_USER=$(npm whoami)
echo -e "  Logged in as: ${GREEN}${NPM_USER}${NC}"

# --- Step 2: Clean install ---
echo ""
echo -e "${GREEN}[2/6]${NC} Clean install..."
rm -rf node_modules dist
npm ci

# --- Step 3: Build ---
echo ""
echo -e "${GREEN}[3/6]${NC} Building..."
npm run build

# --- Step 4: Run tests ---
echo ""
echo -e "${GREEN}[4/6]${NC} Running tests..."
npm test

# --- Step 5: Version bump (optional) ---
BUMP_TYPE=${1:-""}

if [ -n "$BUMP_TYPE" ]; then
  echo ""
  echo -e "${GREEN}[5/6]${NC} Bumping version (${BUMP_TYPE})..."

  if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
    echo -e "${RED}✗ Invalid bump type: ${BUMP_TYPE}. Use: patch, minor, or major${NC}"
    exit 1
  fi

  npm version "$BUMP_TYPE" --no-git-tag-version
  NEW_VERSION=$(node -p "require('./package.json').version")
  echo -e "  New version: ${GREEN}${NEW_VERSION}${NC}"
else
  echo ""
  echo -e "${GREEN}[5/6]${NC} No version bump requested, publishing current version..."
  NEW_VERSION=$(node -p "require('./package.json').version")
  echo -e "  Version: ${GREEN}${NEW_VERSION}${NC}"
fi

# --- Step 6: Publish ---
echo ""
echo -e "${GREEN}[6/6]${NC} Publishing to npm..."

# Show what will be published
echo ""
echo -e "  ${YELLOW}Package:${NC}  @romatech/swagger@${NEW_VERSION}"
echo -e "  ${YELLOW}Registry:${NC} https://registry.npmjs.org"
echo -e "  ${YELLOW}Access:${NC}   public"
echo ""

read -p "  Confirm publish? (y/N) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${RED}✗ Publish cancelled${NC}"
  exit 0
fi

npm publish --access public

# --- Done ---
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ Published @romatech/swagger@${NEW_VERSION}${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  View: https://www.npmjs.com/package/@romatech/swagger"
echo ""
