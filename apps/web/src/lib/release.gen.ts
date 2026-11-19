/**
 * Static download targets.
 *
 * Filenames in the `nixus-downloads` S3 bucket are stable, so the URLs
 * never change between releases — overwriting the binaries in S3 is
 * enough to ship a new version. No build-time fetch.
 */

export const release = {
  version: "latest",
  assets: {
    macos: { url: "https://nixus-downloads.s3.amazonaws.com/nixus_universal.dmg" },
    windows: { url: "https://nixus-downloads.s3.amazonaws.com/nixus_x64-setup.exe" },
  },
} as const;
