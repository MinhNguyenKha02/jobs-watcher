# Atomic Commit Workflow & Pre-commit Checks

This repository enforces high code quality and clear commit history using Husky pre-commit hooks and an atomic commit workflow.

## Pre-commit Checks (Automated)

On every commit, the following checks run automatically:

- **Lint staged files**: `eslint` and `prettier` auto-fix staged code.
- **Type-check**: Ensures TypeScript code is type-safe.
- **Tests**: Runs the test suite to prevent regressions.

If any check fails, the commit is aborted.

## Atomic Commit Workflow

1. **Review your changes**:
   - Use `git status` and `git diff` to inspect your work.
   - Stage only related changes: `git add <file1> <file2> ...`.
   - Use `npx lint-staged` to see what will be auto-fixed.
2. **Check staged changes**:
   - Use `git diff --cached` to review what is staged.
   - Use `npx husky run pre-commit` to manually run hooks if needed.
3. **Commit with a clear, conventional message**:
   - Use [Conventional Commits](https://www.conventionalcommits.org/):
     - `feat: add new feature`
     - `fix: correct a bug`
     - `docs: update documentation`
     - `refactor: code change without behavior change`
   - Example: `git commit -m "fix: handle null values in job parser"`
4. **Repeat for unrelated changes**: Each commit should be atomic and auditable.

## Auditable Commit Messages
- Every commit must have a clear, descriptive message.
- Avoid generic messages like `update` or `fix bug`.
- Use the imperative mood and reference the scope if possible.

## Example
```sh
git status
git add src/job-extraction.ts
git diff --cached
git commit -m "fix(job-extraction): handle missing salary field"
```

---

For questions, see the documentation or ask a maintainer.
