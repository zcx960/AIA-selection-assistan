import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { join } from 'node:path'

// Native modules talk to the OS through a .node, so the package has to leave
// the asar — electron-builder's smart unpack does that automatically for
// anything shipping a binary. The trade-off: whatever lands in
// resources/app.asar.unpacked can disappear (temp cleanup, AV quarantine),
// and if the package's package.json goes with it the ESM resolver throws
// ENOENT while the main process is still booting — no window, no error UI.
// That is exactly what happened in #9, so verify the shipped layout instead of
// trusting it.
const NATIVE_MODULES = [
  { dir: 'selection-hook', entry: 'index.js', binary: 'selection-hook.node' },
  { dir: 'uiohook-napi', entry: 'dist/index.js', binary: 'uiohook-napi.node' }
]

const ARCH_NAME = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64' }

/** Read the JSON header of an asar archive (16-byte pickle, then the payload). */
export function readAsarHeader(asarPath) {
  const fd = openSync(asarPath, 'r')
  try {
    const prefix = Buffer.alloc(16)
    readSync(fd, prefix, 0, 16, 0)
    const jsonSize = prefix.readUInt32LE(12)
    const json = Buffer.alloc(jsonSize)
    readSync(fd, json, 0, jsonSize, 16)
    return JSON.parse(json.toString('utf8'))
  } finally {
    closeSync(fd)
  }
}

export function getFileNode(header, segments) {
  let node = header
  for (const segment of segments) {
    node = node?.files?.[segment]
    if (node == null) return null
  }
  return node.files == null ? node : null
}

/** A file counts as shipped when it is readable either way the asar stores it. */
export function isShipped(header, unpackedDir, segments) {
  const node = getFileNode(header, segments)
  if (node == null) return false
  // unpacked (or link without a data-region offset) → the bytes live outside.
  if (node.unpacked === true || node.offset == null) {
    return existsSync(join(unpackedDir, ...segments))
  }
  return true
}

export function verifyAsarUnpack(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir)
  const asarPath = join(resourcesDir, 'app.asar')
  if (!existsSync(asarPath)) return

  const header = readAsarHeader(asarPath)
  const unpackedDir = `${asarPath}.unpacked`
  const platform = context.electronPlatformName === 'darwin' ? 'darwin' : 'win32'
  const arch = ARCH_NAME[context.arch] ?? 'x64'
  const problems = []

  for (const mod of NATIVE_MODULES) {
    const base = ['node_modules', mod.dir]

    for (const file of ['package.json', mod.entry]) {
      const segments = [...base, ...file.split('/')]
      if (getFileNode(header, segments) == null) {
        problems.push(`${mod.dir}/${file} is not in the asar header at all`)
      } else if (!isShipped(header, unpackedDir, segments)) {
        problems.push(
          `${mod.dir}/${file} is declared outside the asar but missing from app.asar.unpacked`
        )
      }
    }

    const binary = [...base, 'prebuilds', `${platform}-${arch}`, mod.binary]
    if (!isShipped(header, unpackedDir, binary)) {
      problems.push(`${mod.dir} has no ${platform}-${arch} binary on disk`)
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `[verify-asar-unpack] packaged resources are incomplete — this build would ` +
        `crash at startup on ${platform}-${arch}:\n  - ${problems.join('\n  - ')}`
    )
  }

  console.log(`[verify-asar-unpack] native modules intact (${platform}-${arch})`)
}
