import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agentProfiles, detectAgents, findExecutable } from './discovery'
import { normalizeSettings } from '@shared/actions'

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'aia-agent-discovery-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
async function executable(name: string) { const path = join(directory, name); await writeFile(path, 'This file must never execute'); await chmod(path, 0o755); return path }
const cliName = (name: string) => process.platform === 'win32' ? `${name}.cmd` : name

describe('local ACP discovery and configuration', () => {
  it('distinguishes native entries, adapter-needed CLIs and editor-only CLIs without executing them', async () => {
    const gemini = await executable(cliName('gemini'))
    await executable(cliName('claude')); await executable(cliName('npx')); await executable(cliName('antigravity'))
    const detected = await detectAgents([directory])
    expect(detected.find((agent) => agent.id === 'gemini')).toMatchObject({ status: 'available', launch: { command: gemini, args: ['--acp'] } })
    expect(detected.find((agent) => agent.id === 'claude')).toMatchObject({ status: 'adapter-needed', launch: { args: ['-y', '--package', '@agentclientprotocol/claude-agent-acp@0.107.0', '--', 'claude-agent-acp'] } })
    expect(detected.find((agent) => agent.id === 'antigravity')?.status).toBe('cli-only')
    expect(detected.find((agent) => agent.id === 'codex')?.status).toBe('not-found')
  })
  it('finds Windows npm shims and absolute executable paths with spaces', async () => {
    const path = await executable('agent with space.cmd')
    expect(await findExecutable('agent with space', [directory], 'win32')).toBe(path)
    expect(await findExecutable(path, [], 'win32')).toBe(path)
  })
  it('has unique profiles and retains ACP settings through settings migration and template selection', () => {
    expect(new Set(agentProfiles.map((profile) => profile.id)).size).toBe(agentProfiles.length)
    const settings = normalizeSettings({ providerTemplates: [{ id: 'local', name: 'Local', provider: {
      apiType: 'acp', model: '', acp: { command: 'gemini', args: ['--acp'], env: { GOOD: 'yes', BAD: 123, 'BAD-KEY': 'no' } }
    } }], activeProviderTemplateId: 'local' })
    expect(settings.provider.apiType).toBe('acp')
    expect(settings.provider.acp).toEqual({ command: 'gemini', args: ['--acp'], cwd: '', env: { GOOD: 'yes' }, permissionMode: 'deny' })
    expect(settings.provider.model).toBe('')
  })
})
