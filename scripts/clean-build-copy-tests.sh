#!/bin/bash
# Clean dist, build, then copy tests for ESM/JS compliance
set -e
rm -rf dist
npx tsc
cp -r tests dist/
