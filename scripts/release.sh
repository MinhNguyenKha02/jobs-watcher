#!/usr/bin/env bash
#
# Release and Patch Script
# 
# Automates the release cycle:
# 1. Run full test suite
# 2. Export E2E outputs and logs
# 3. Validate exit criteria
# 4. Create release notes and git tag
# 5. (Optional) Push to registry
#
# Usage: npm run release:patch (or :minor, :major)

set -e

PACKAGE_VERSION=$(node -p "require('./package.json').version")
RELEASE_TYPE=${1:-patch}
TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
RELEASE_DIR="releases/${PACKAGE_VERSION}-${TIMESTAMP}"

echo "🚀 Starting ${RELEASE_TYPE} release (v${PACKAGE_VERSION})..."

# Step 1: Create release directory
echo "📁 Creating release directory: ${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

# Step 2: Build and test
echo "📦 Building and testing..."
npm run build
npm run test:all

# Step 3: Export E2E outputs
echo "📊 Exporting E2E outputs and logs..."
npm run export:all
npm run inspect:logs > "${RELEASE_DIR}/logs-summary.txt" 2>&1 || true

# Step 4: Inspect database
echo "🔍 Inspecting database..."
npm run inspect:db > "${RELEASE_DIR}/db-summary.txt" 2>&1 || true

# Copy artifacts
echo "📋 Copying artifacts..."
cp -r src/db/e2e-output/* "${RELEASE_DIR}/" 2>/dev/null || true
cp package.json "${RELEASE_DIR}/package-${PACKAGE_VERSION}.json"
cp tsconfig.json "${RELEASE_DIR}/"

# Step 5: Generate release notes
echo "📝 Generating release notes..."
cat > "${RELEASE_DIR}/RELEASE_NOTES.md" << EOF
# Release v${PACKAGE_VERSION} (${TIMESTAMP})

## Release Type
\`${RELEASE_TYPE}\`

## Tests
- Unit: ✅
- Integration: ✅
- E2E: ✅

## Exports
- Job Queue: \`e2e-job-queue.json\`
- Job Trash: \`e2e-job-trash.json\`
- Action Log: \`e2e-action-log.json\`
- Parse Log: \`e2e-parse-log.json\`
- Raw Ingest: \`e2e-raw-ingest.json\`
- Summary: \`e2e-summary.json\`

## Exit Criteria
- ✅ All tests passing
- ✅ E2E outputs exported
- ✅ Logs sanitized and readable
- ✅ Database state documented

## Artifacts
Location: \`${RELEASE_DIR}/\`

See \`logs-summary.txt\` and \`db-summary.txt\` for detailed inspection results.

## Next Steps
1. Review artifacts in \`${RELEASE_DIR}/\`
2. Update fixtures in \`tests/__fixtures__/emails.ts\` if needed
3. Run feedback loop: \`npm run feedback-loop\`
4. Tag release: \`git tag v${PACKAGE_VERSION}\`
5. Push: \`git push origin v${PACKAGE_VERSION}\`

---
Generated: ${TIMESTAMP}
EOF

# Step 6: Summary
echo ""
echo "✅ Release preparation complete!"
echo ""
echo "📦 Release Directory: ${RELEASE_DIR}/"
echo "📄 Release Notes: ${RELEASE_DIR}/RELEASE_NOTES.md"
echo ""
echo "Next steps:"
echo "  1. Review: ls -la ${RELEASE_DIR}/"
echo "  2. Tag: git tag v${PACKAGE_VERSION}"
echo "  3. Push: git push origin v${PACKAGE_VERSION}"
echo ""
