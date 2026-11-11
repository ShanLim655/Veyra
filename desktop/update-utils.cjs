const FINAL_ASSET_HOSTS = new Set([
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function isReleaseVersion(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

function compareVersions(left, right) {
  if (!isReleaseVersion(left) || !isReleaseVersion(right)) return 0;
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function isReleaseAssetUrl(value, version) {
  try {
    const url = new URL(String(value));
    if (!isReleaseVersion(version)) return false;
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname === `/ShanLim655/Veyra/releases/download/v${version}/Veyra${version}.exe`
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function isFinalAssetUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && FINAL_ASSET_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

module.exports = { compareVersions, isReleaseVersion, isReleaseAssetUrl, isFinalAssetUrl, isSha256 };
