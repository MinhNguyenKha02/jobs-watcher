# Profile Sync Script

Automatically syncs changes from `profile.prebuilt.json` to `portfolio/data.ts`.

## Setup

Install dependencies:
```bash
npm install
# or
pnpm install
```

## Usage

### One-time sync
Manually sync profile.prebuilt.json to portfolio/data.ts:
```bash
npm run sync:profile
# or
pnpm sync:profile
```

### Watch mode
Watch for changes and auto-sync whenever profile.prebuilt.json is modified:
```bash
npm run sync:profile:watch
# or
pnpm sync:profile:watch
```

Press `Ctrl+C` to stop the watcher.

## How it works

The script:
1. **Reads** `profile.prebuilt.json` (your single source of truth)
2. **Transforms** the data structure to match `portfolio/data.ts` format
3. **Generates** TypeScript code for the `profile` export
4. **Replaces** the old `profile` export in `portfolio/data.ts`

## File Locations

- **Source**: `./profile.prebuilt.json` (primary profile data)
- **Target**: `./portfolio/data.ts` (TypeScript profile constant)
- **Script**: `./scripts/sync-profile.ts`

## Why use this?

- **Single source of truth**: Profile.prebuilt.json is your master profile
- **Type safety**: portfolio/data.ts maintains TypeScript types and interfaces
- **No manual syncing**: Watch mode keeps everything in sync automatically
- **Easy updates**: Just edit profile.prebuilt.json and changes flow automatically

## Manual editing

If you need to manually update portfolio/data.ts (e.g., for advanced customization):
1. Make your changes
2. Don't forget to sync back to profile.prebuilt.json for consistency
3. Or run `npm run sync:profile` to reset to the prebuilt version
