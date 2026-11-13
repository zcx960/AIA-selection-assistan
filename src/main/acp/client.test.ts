import { afterEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AcpConnection, closeAcpConnections, connectAgent, streamAcp, type PermissionHandler } from './client'
import { emptyAcpConfig } from '@shared/acp'

const fixture = fileURLToPath(new URL('./fixtures/agent.cjs', import.meta.url))
const start = async (mode = 'normal', permission?: PermissionHandler, permissionMode: 'deny' | 'ask' = 'deny') => {
  const controller = new AbortController()
  const child = spawn(process.execPath, [fixture, mode], { detached: process.platform !== 'win32', stdio: 'pipe' })
  const connection = new AcpConnection(child, controller.signal, { ...emptyAcpConfig, permissionMode }, permission, 1500)
  await connection.initialize(tmpdir())
  return { connection, controller, child }
}
afterEach(() => closeAcpConnections())

describe('ACP stdio transport and lifecycle', () => {
  it('handshakes, extracts grouped models and streams fragmented UTF-8 content and reasoning', async () => {
    const { connection } = await start()
    expect(connection.models()).toEqual(['test-model'])
    await connection.selectModel('test-model')
    const deltas: unknown[] = []
    await streamAcp(connection, [{ role: 'user', text: 'Hello' }], 'System instructions', (delta) => deltas.push(delta), () => {})
    expect(deltas).toEqual([{ reasoning: 'Thinking' }, { content: '你好 ACP' }])
  })
  it('passes history, system instructions and base64 images without dropping content', async () => {
    const { connection } = await start('echo')
    let text = ''
    await streamAcp(connection, [{ role: 'user', text: 'Earlier' }, { role: 'assistant', text: 'Answer' },
      { role: 'user', text: 'Latest', images: ['data:image/png;base64,YWJj'] }], 'System', (delta) => { text += delta.content ?? '' }, () => {})
    expect(text).toContain('Earlier'); expect(text).toContain('Answer'); expect(text).toContain('Latest'); expect(text).toContain('System')
    expect(JSON.parse(text).at(-1)).toEqual({ type: 'image', mimeType: 'image/png', data: 'YWJj' })
  })
  it('rejects unsupported images and unavailable model selection explicitly', async () => {
    const { connection } = await start('no-images')
    await expect(streamAcp(connection, [{ role: 'user', text: 'Image', images: ['data:image/png;base64,YWJj'] }], '', () => {}, () => {})).rejects.toThrow('does not support image')
    const other = await start('no-models')
    await expect(other.connection.selectModel('anything')).rejects.toThrow('does not advertise model selection')
  })
  it('denies permissions by default and never silently grants permanent permission', async () => {
    for (const mode of ['deny', 'ask'] as const) {
      const { connection } = await start('permission', async () => 'always', mode)
      let text = ''
      await streamAcp(connection, [{ role: 'user', text: 'Test' }], '', (delta) => { text += delta.content ?? '' }, () => {})
      expect(JSON.parse(text)).toEqual({ outcome: 'selected', optionId: 'reject' })
    }
  })
  it('permits only explicit allow-once selection', async () => {
    const { connection } = await start('permission', async () => 'once', 'ask')
    let text = ''
    await streamAcp(connection, [{ role: 'user', text: 'Test' }], '', (delta) => { text += delta.content ?? '' }, () => {})
    expect(JSON.parse(text)).toEqual({ outcome: 'selected', optionId: 'once' })
  })
  it('aborts an in-flight prompt and closes its process', async () => {
    const { connection, controller, child } = await start('hang')
    const prompt = streamAcp(connection, [{ role: 'user', text: 'Wait' }], '', () => {}, () => {})
    controller.abort()
    await expect(prompt).rejects.toThrow('cancelled')
    expect(child.stdin?.writableEnded).toBe(true)
  })
  it.each([['version', 'Unsupported ACP'], ['auth', 'CLI login'], ['junk', 'did not return ACP'], ['exit', 'ACP agent exited'], ['timeout', 'timed out']])('reports %s failures without hanging', async (mode, message) => {
    await expect(start(mode)).rejects.toThrow(message)
  })
  it('validates working directories and command existence before launch', async () => {
    const provider = { apiType: 'acp' as const, baseUrl: '', apiKey: '', model: '', temperature: 1,
      acp: { ...emptyAcpConfig, command: 'aia-command-does-not-exist' } }
    await expect(connectAgent(provider, tmpdir(), new AbortController().signal)).rejects.toThrow('executable not found')
    await expect(connectAgent({ ...provider, acp: { ...provider.acp, cwd: 'relative' } }, tmpdir(), new AbortController().signal)).rejects.toThrow('absolute directory')
  })
  it('connects a configured process with spaced paths, including npm cmd shims on Windows', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aia acp shim '))
    try {
      const script = join(directory, 'agent fixture.cjs')
      await copyFile(fixture, script)
      let command = process.execPath
      let args = [script, 'normal']
      if (process.platform === 'win32') {
        command = join(directory, 'agent shim.cmd')
        args = ['normal']
        await writeFile(command, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`)
      }
      const connection = await connectAgent({ apiType: 'acp', baseUrl: '', apiKey: '', model: '', temperature: 1,
        acp: { ...emptyAcpConfig, command, args } }, tmpdir(), new AbortController().signal)
      expect(connection.models()).toEqual(['test-model'])
      connection.close()
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
