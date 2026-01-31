#!/usr/bin/env bun
import { $ } from "bun";

const dir = new URL("..", import.meta.url).pathname;
process.chdir(dir);

// Whitelist of allowed npm version bump types to prevent command injection
const ALLOWED_BUMP_TYPES = ["major", "minor", "patch", "premajor", "preminor", "prepatch", "prerelease"] as const;
type BumpType = typeof ALLOWED_BUMP_TYPES[number];

// Validate user input against whitelist
function validateBumpType(input: string): BumpType {
  if (ALLOWED_BUMP_TYPES.includes(input as any)) {
    return input as BumpType;
  }
  console.error(`Invalid bump type: ${input}`);
  console.error(`Allowed types: ${ALLOWED_BUMP_TYPES.join(", ")}`);
  process.exit(1);
}

// Sanitize and validate the bump type from command line arguments
const bumpType = validateBumpType(process.argv[2] || "patch");

console.log(`Bumping ${bumpType} version...`);

// Bump version in package.json
await $`npm version ${bumpType} --no-git-tag-version`;

// Read the new version
const pkg = await Bun.file("./package.json").json();
const version = pkg.version;

// Validate version format to prevent injection in git commit message
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Invalid version format: ${version}`);
  process.exit(1);
}

console.log(`New version: ${version}`);

// Commit the version bump
await $`git add package.json`;
await $`git commit -m "Bump version to ${version}"`;
await $`git push`;

// Trigger GitHub workflow
console.log(`Triggering publish workflow...`);
await $`gh workflow run publish.yml -f bump="${bumpType}"`;

console.log(`✓ Version bumped to ${version} and publish workflow triggered`);
