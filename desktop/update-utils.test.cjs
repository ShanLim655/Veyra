const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, isReleaseVersion, isReleaseAssetUrl, isFinalAssetUrl, isSha256 } = require('./update-utils.cjs');

test('release versions accept only three numeric components', () => {
  assert.equal(isReleaseVersion('1.2.0'), true);
  assert.equal(isReleaseVersion('v1.2.0'), false);
  assert.equal(isReleaseVersion('1.2.0/../../payload'), false);
  assert.equal(isReleaseVersion('1.2'), false);
});

test('version comparison handles major, minor, and patch changes', () => {
  assert.equal(compareVersions('1.2.0', '1.1.8'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.1.8', '1.2.0'), -1);
  assert.equal(compareVersions('invalid', '1.2.0'), 0);
});

test('installer URLs must target this repository release assets over HTTPS', () => {
  assert.equal(isReleaseAssetUrl('https://github.com/ShanLim655/Veyra/releases/download/v1.2.0/VeyraSetup.exe'), true);
  assert.equal(isReleaseAssetUrl('http://github.com/ShanLim655/Veyra/releases/download/v1.2.0/VeyraSetup.exe'), false);
  assert.equal(isReleaseAssetUrl('https://github.com/attacker/Other/releases/download/v1.2.0/setup.exe'), false);
  assert.equal(isReleaseAssetUrl('https://github.com.evil.example/ShanLim655/Veyra/releases/download/v1.2.0/setup.exe'), false);
});

test('download redirects must end on an approved HTTPS asset host', () => {
  assert.equal(isFinalAssetUrl('https://objects.githubusercontent.com/assets/file'), true);
  assert.equal(isFinalAssetUrl('https://release-assets.githubusercontent.com/assets/file'), true);
  assert.equal(isFinalAssetUrl('https://github.com/ShanLim655/Veyra/releases/download/v1.2.0/latest.json'), false);
  assert.equal(isFinalAssetUrl('https://evil.example/assets/file'), false);
  assert.equal(isFinalAssetUrl('http://objects.githubusercontent.com/assets/file'), false);
});

test('installer checksums must be complete SHA-256 hex digests', () => {
  assert.equal(isSha256('a'.repeat(64)), true);
  assert.equal(isSha256('A'.repeat(64)), true);
  assert.equal(isSha256('a'.repeat(63)), false);
  assert.equal(isSha256('z'.repeat(64)), false);
});
