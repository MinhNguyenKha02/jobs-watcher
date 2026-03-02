#!/bin/bash
# Copy tests to dist/tests for ESM/JS compliance
set -e
rm -rf dist/tests
cp -r tests dist/
