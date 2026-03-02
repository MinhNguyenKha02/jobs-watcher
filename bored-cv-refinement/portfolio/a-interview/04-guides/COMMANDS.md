# 🚀 Quick Commands & Shortcuts

**Last Updated:** March 3, 2026  
**Purpose:** Copy-paste commands for common tasks

---

## 📅 Daily Practice Setup

### Start Today's Practice Session

```bash
# Copy template to today's file
cp daily-compression-template.md daily-$(date +%Y%m%d).md

# Open today's file for editing
code daily-$(date +%Y%m%d).md  # VS Code
# OR
nano daily-$(date +%Y%m%d).md  # Terminal editor
# OR
open daily-$(date +%Y%m%d).md  # macOS default editor
```

### Open Practice Files Together

```bash
# Open all files needed for practice
code QUESTION-TRACKER.md daily-$(date +%Y%m%d).md interview-preparation.md
```

---

## 📊 Progress Tracking

### View This Week's Practice Files

```bash
# List all daily files from current week
ls -la daily-$(date +%Y%m)*.md

# Count how many practice sessions this week
ls -1 daily-$(date +%Y%m)*.md | wc -l
```

### Search Your Practice History

```bash
# Find all times you practiced a specific question
grep -r "POST /orders" daily-*.md

# Find your scores for a specific date range
grep "Score:" daily-202603*.md

# Find which blocks you consistently miss
grep "Missing/Weak" daily-*.md | sort | uniq -c | sort -rn
```

---

## 🗂️ File Navigation

### Quick Open Essential Files

```bash
# Navigation
open README.md              # Hub
open QUICK-REFERENCE.md     # Daily cheat sheet
open QUICKSTART.md          # First week guide

# Practice
open daily-compression-template.md
open QUESTION-TRACKER.md
open interview-preparation.md

# Evaluation
open RESPONSE-EVALUATION-FRAMEWORK.md
open recruiter-enforced.md
open gaps.md

# System
open STRUCTURE.md
open SYSTEM-DESIGN.md
open VISUAL-FLOWS.md
open INDEX.md
```

### View File in Terminal

```bash
# Quick view without opening editor
cat QUICK-REFERENCE.md | less

# Search within a file
grep "5-block" interview-preparation.md

# Count lines in file
wc -l WORKFLOW.md
```

---

## 📈 Weekly Review Commands

### Collect Week's Data

```bash
# Create weekly summary directory
mkdir -p weekly-reviews
cd weekly-reviews

# Copy this week's files for review
cp ../daily-$(date +%Y%m)*.md .

# Count questions attempted this week
grep "Today's Focus" ../daily-$(date +%Y%m)*.md | wc -l

# Average score this week (requires manual calculation)
grep "Overall Score" ../daily-$(date +%Y%m)*.md
```

### Generate Statistics

```bash
# How many 5/5 scores this week?
grep "5/5" daily-$(date +%Y%m)*.md | wc -l

# Which blocks are most commonly missing?
grep "Missing:" daily-$(date +%Y%m)*.md | \
  sed 's/.*Missing: //' | \
  tr ',' '\n' | \
  sort | uniq -c | sort -rn
```

---

## 🎯 Question Management

### Find Specific Question in Tracker

```bash
# Search for question by keyword
grep -A 10 "POST /orders" QUESTION-TRACKER.md

# See all questions in a category
grep "^#### Q" QUESTION-TRACKER.md
```

### Check Your Mastery Progress

```bash
# Count mastered questions (5/5 three times)
grep "Mastered" QUESTION-TRACKER.md | wc -l

# See total questions available
grep "^#### Q" QUESTION-TRACKER.md | wc -l
```

---

## 🔍 Search Across All Files

### Find Concept or Topic

```bash
# Search all markdown files
grep -r "idempotency" *.md

# Search with context (3 lines before/after)
grep -C 3 "transaction" *.md

# Case-insensitive search
grep -i "singapore" *.md
```

### Find Code Examples

```bash
# Find all code blocks
grep -A 20 "```" interview-preparation.md

# Find specific programming language examples
grep -A 20 "```javascript" *.md
```

---

## 📝 Template Management

### Create Custom Practice Template

```bash
# Create a focused template for specific gap
cp daily-compression-template.md gap1-template.md

# Edit to focus on Gap 1 (Structural Communication)
# Remove unnecessary sections, add Gap 1 specific prompts
```

### Batch Create Week's Files

```bash
# Create files for entire week (Monday-Friday)
for i in {3..7}; do
  cp daily-compression-template.md daily-2026030$i.md
done
```

---

## 🗑️ Cleanup & Organization

### Archive Old Practice Files

```bash
# Create archive directory
mkdir -p archive/2026-03

# Move last month's files
mv daily-202602*.md archive/2026-02/

# Compress old archives
tar -czf archive/2026-02.tar.gz archive/2026-02/
```

### Organize by Week

```bash
# Create week-based structure
mkdir -p weeks/week-{1..4}

# Move Week 1 files (Days 1-7)
mv daily-2026030{1..7}.md weeks/week-1/
```

---

## 📤 Export & Backup

### Backup Your Progress

```bash
# Create timestamped backup
tar -czf backup-$(date +%Y%m%d).tar.gz daily-*.md QUESTION-TRACKER.md gaps.md

# Copy to cloud storage (example: Dropbox)
cp backup-$(date +%Y%m%d).tar.gz ~/Dropbox/interview-prep/
```

### Export Progress Report

```bash
# Generate simple text report
echo "Interview Prep Progress - $(date +%Y-%m-%d)" > progress-report.txt
echo "=======================================" >> progress-report.txt
echo "" >> progress-report.txt
echo "Total Practice Sessions: $(ls -1 daily-*.md | wc -l)" >> progress-report.txt
echo "Mastered Questions: $(grep -c "Mastered" QUESTION-TRACKER.md)" >> progress-report.txt
echo "Current Focus: $(grep "Current Focus" QUESTION-TRACKER.md)" >> progress-report.txt
cat progress-report.txt
```

---

## 🎨 Display & Formatting

### Pretty Print Files

```bash
# View file with syntax highlighting (if installed)
bat QUICK-REFERENCE.md

# Convert markdown to HTML for browser viewing
pandoc README.md -o README.html
open README.html
```

### Print Reference Card

```bash
# Print QUICK-REFERENCE.md to PDF (macOS)
cupsfilter QUICK-REFERENCE.md > QUICK-REFERENCE.pdf

# OR use markdown-pdf (if installed)
markdown-pdf QUICK-REFERENCE.md
```

---

## 🔧 Utility Scripts

### Create Helper Script: `practice.sh`

```bash
#!/bin/bash
# Save this as: practice.sh
# Usage: ./practice.sh

TODAY=$(date +%Y%m%d)
DAILY_FILE="daily-${TODAY}.md"

# Copy template
cp daily-compression-template.md "$DAILY_FILE"

# Open files
code QUESTION-TRACKER.md "$DAILY_FILE" interview-preparation.md

echo "✅ Practice session started for ${TODAY}"
echo "Files opened: QUESTION-TRACKER.md, ${DAILY_FILE}, interview-preparation.md"
```

Make executable:
```bash
chmod +x practice.sh
```

### Create Helper Script: `weekly-review.sh`

```bash
#!/bin/bash
# Save this as: weekly-review.sh
# Usage: ./weekly-review.sh

WEEK_START=$(date -d "last monday" +%Y%m%d)
YEAR_MONTH=$(date +%Y%m)

echo "📊 Weekly Review for week starting ${WEEK_START}"
echo "=============================================="
echo ""

# Count sessions
SESSIONS=$(ls -1 daily-${YEAR_MONTH}*.md 2>/dev/null | wc -l)
echo "Total sessions this month: ${SESSIONS}"

# Open review files
code QUESTION-TRACKER.md WORKFLOW.md gaps.md

echo ""
echo "✅ Review files opened"
echo "Follow Weekly Review Checklist in WORKFLOW.md"
```

Make executable:
```bash
chmod +x weekly-review.sh
```

---

## 🎯 Keyboard Shortcuts (VS Code)

### While Editing Daily Files

```
Cmd/Ctrl + Shift + V    Preview markdown
Cmd/Ctrl + K V          Open preview side-by-side
Cmd/Ctrl + Shift + F    Search across all files
Cmd/Ctrl + P            Quick open file
Cmd/Ctrl + Shift + P    Command palette
```

### Markdown Editing

```
Cmd/Ctrl + B            Bold selected text
Cmd/Ctrl + I            Italic selected text
Cmd/Ctrl + Shift + ]    Increase heading level
Cmd/Ctrl + Shift + [    Decrease heading level
```

---

## 📱 Mobile Access (Optional)

### Sync to Mobile Device

```bash
# Using iCloud/Dropbox/Google Drive
cp *.md ~/iCloud/interview-prep/
# OR
cp *.md ~/Dropbox/interview-prep/
# OR
cp *.md ~/Google\ Drive/interview-prep/

# View on mobile using:
# - iA Writer (iOS/Android)
# - Obsidian Mobile (iOS/Android)
# - Notion (import markdown files)
```

---

## 🚀 Quick Start Aliases (Optional)

Add to your `.bashrc` or `.zshrc`:

```bash
# Interview prep aliases
alias ip-start='cp daily-compression-template.md daily-$(date +%Y%m%d).md && code daily-$(date +%Y%m%d).md'
alias ip-track='code QUESTION-TRACKER.md'
alias ip-review='code WORKFLOW.md gaps.md QUESTION-TRACKER.md'
alias ip-examples='code interview-preparation.md'
alias ip-ref='cat QUICK-REFERENCE.md | less'
alias ip-help='cat README.md | less'
```

After adding, reload:
```bash
source ~/.bashrc  # or ~/.zshrc
```

Then use:
```bash
ip-start     # Start today's practice
ip-track     # Open tracker
ip-review    # Weekly review
ip-examples  # See examples
ip-ref       # Quick reference
ip-help      # Help/README
```

---

## 💡 Pro Tips

### Use Grep for Quick Lookup

```bash
# Find all validation examples
grep -A 5 "Validation" interview-preparation.md

# Find all Singapore-specific tips
grep -i "singapore" *.md
```

### Use Find for File Discovery

```bash
# Find all markdown files
find . -name "*.md"

# Find files modified today
find . -name "*.md" -mtime 0

# Find large files (> 500 lines)
find . -name "*.md" -exec wc -l {} \; | awk '$1 > 500'
```

### Use Watch for Real-Time Monitoring

```bash
# Monitor practice file count (updates every 2 seconds)
watch -n 2 'ls -1 daily-*.md | wc -l'

# Monitor latest file updates
watch -n 5 'ls -lt daily-*.md | head -5'
```

---

## 📋 Checklists

### Before Each Practice Session

```bash
# Quick system check
[ -f QUESTION-TRACKER.md ] && echo "✅ Tracker ready" || echo "❌ Tracker missing"
[ -f interview-preparation.md ] && echo "✅ Examples ready" || echo "❌ Examples missing"
[ -f daily-compression-template.md ] && echo "✅ Template ready" || echo "❌ Template missing"
```

### After Each Practice Session

```bash
# Verify completion
grep -q "Learning Log" daily-$(date +%Y%m%d).md && \
  echo "✅ Session complete" || \
  echo "⚠️ Session incomplete - finish Learning Log"
```

---

## 🎯 Most Used Commands (Quick Reference)

```bash
# Daily
cp daily-compression-template.md daily-$(date +%Y%m%d).md  # Start practice
code daily-$(date +%Y%m%d).md QUESTION-TRACKER.md          # Open files
grep "Score:" daily-$(date +%Y%m%d).md                     # Check score

# Weekly
ls -la daily-$(date +%Y%m)*.md                             # List week files
grep "Overall Score" daily-$(date +%Y%m)*.md               # See scores
code QUESTION-TRACKER.md gaps.md                           # Review progress

# Search
grep -r "keyword" *.md                                     # Find anything
grep -c "Mastered" QUESTION-TRACKER.md                     # Count mastered

# Backup
tar -czf backup-$(date +%Y%m%d).tar.gz daily-*.md          # Backup practice
```

---

**Save this file for quick command reference!**

**File:** [COMMANDS.md](COMMANDS.md)
