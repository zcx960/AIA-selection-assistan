import { spawnSync } from 'node:child_process'
import { verifyAsarUnpack } from './verify-asar-unpack.mjs'

export default async function afterPack(context) {
  // Windows-only: drop the source tree / docs / foreign prebuilds that the
  // selection-hook package ships with but never loads at runtime.
  if (context.electronPlatformName === 'win32') {
    const prebuildFolder = context.arch === 3 ? 'win32-arm64' : 'win32-x64'

    const result = spawnSync(
      process.execPath,
      ['scripts/prune-selection-hook-win.js', context.appOutDir, prebuildFolder],
      {
        stdio: 'inherit',
        cwd: process.cwd()
      }
    )

    if (result.status !== 0) {
      throw new Error(`afterPack prune script failed with status ${result.status ?? 'unknown'}`)
    }
  }

  // Both platforms: refuse to ship a package whose native modules are unpacked
  // in a way that lets a missing app.asar.unpacked break startup. Runs after
  // pruning so it validates what actually lands in the installer.
  verifyAsarUnpack(context)
}
