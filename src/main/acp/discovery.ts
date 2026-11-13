import { access, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import type { DetectedAgent } from '@shared/acp'
import { emptyAcpConfig } from '@shared/acp'

interface AgentProfile {
  id: string
  name: string
  commands: string[]
  args: string[]
  cli?: string[]
  adapter?: { package: string; bin: string }
  website?: string
  env?: Record<string, string>
}

// Launch profiles checked against the ACP Registry and upstream ACP entry points.
// Discovery never executes a CLI, downloads a package, or reads its credentials.
export const agentProfiles: AgentProfile[] = [
  { id: 'claude', name: 'Claude Code', commands: ['claude-agent-acp'], args: [], cli: ['claude'], adapter: { package: '@agentclientprotocol/claude-agent-acp@0.107.0', bin: 'claude-agent-acp' } },
  { id: 'codex', name: 'Codex', commands: ['codex-acp'], args: [], cli: ['codex'], adapter: { package: '@agentclientprotocol/codex-acp@2.6.0', bin: 'codex-acp' } },
  { id: 'codebuddy', name: 'CodeBuddy Code', commands: ['codebuddy'], args: ['--acp'], website: 'https://www.codebuddy.cn/cli/' },
  { id: 'pi', name: 'Pi', commands: ['pi-acp'], args: [], cli: ['pi'], adapter: { package: 'pi-acp@0.0.34', bin: 'pi-acp' } },
  { id: 'antigravity', name: 'Google Antigravity', commands: ['agy_acp_server.par', 'agy_acp_server'], args: process.platform === 'linux' ? ['--uid='] : [], cli: ['antigravity', 'agy'], website: 'https://antigravity.google/docs/ide/extensions' },
  { id: 'gemini', name: 'Gemini CLI', commands: ['gemini'], args: ['--acp'] },
  { id: 'copilot', name: 'GitHub Copilot', commands: ['copilot'], args: ['--acp', '--stdio'] },
  { id: 'cursor', name: 'Cursor Agent', commands: ['cursor-agent'], args: ['acp'], cli: ['cursor'] },
  { id: 'opencode', name: 'OpenCode', commands: ['opencode'], args: ['acp'] },
  { id: 'qwen', name: 'Qwen Code', commands: ['qwen'], args: ['--acp'] },
  { id: 'kimi', name: 'Kimi CLI', commands: ['kimi'], args: ['acp'] },
  { id: 'auggie', name: 'Auggie', commands: ['auggie'], args: ['--acp'], env: { AUGMENT_DISABLE_AUTO_UPDATE: '1' } },
  { id: 'goose', name: 'Goose', commands: ['goose'], args: ['acp'] },
  { id: 'droid', name: 'Factory Droid', commands: ['droid'], args: ['exec', '--output-format', 'acp'] },
  { id: 'vibe', name: 'Mistral Vibe', commands: ['vibe-acp'], args: [], cli: ['vibe'] },
  { id: 'kiro', name: 'Kiro', commands: ['kiro-cli'], args: ['acp', '--agent-engine=v3'], cli: ['kiro-cli-chat', 'kiro'] },
  { id: 'kilo', name: 'Kilo Code', commands: ['kilo'], args: ['acp'] },
  { id: 'cline', name: 'Cline', commands: ['cline'], args: ['--acp'] },
  { id: 'qoder', name: 'Qoder CLI', commands: ['qodercli'], args: ['--acp'] },
  { id: 'junie', name: 'Junie', commands: ['junie'], args: ['--acp=true'] },
  { id: 'devin', name: 'Devin', commands: ['devin'], args: ['acp'] },
  { id: 'grok', name: 'Grok Build', commands: ['grok'], args: ['agent', 'stdio'] },
  { id: 'openclaw', name: 'OpenClaw', commands: ['openclaw'], args: ['acp'] },
  { id: 'iflow', name: 'iFlow', commands: ['iflow'], args: ['--experimental-acp'] },
  { id: 'trae', name: 'Trae CLI', commands: ['traecli'], args: ['acp', 'serve'] },
  { id: 'amp', name: 'Amp', commands: ['amp-acp'], args: [], cli: ['amp'] },
  { id: 'fast-agent', name: 'fast-agent', commands: ['fast-agent-acp'], args: ['-x'], env: { FAST_AGENT_MODEL: 'codexplan' }, cli: ['fast-agent'] },
  { id: 'stakpak', name: 'Stakpak', commands: ['stakpak'], args: ['acp'] },
  { id: 'vtcode', name: 'VT Code', commands: ['vtcode'], args: ['acp'], env: { VT_ACP_ENABLED: '1', VT_ACP_ZED_ENABLED: '1' } },
  { id: 'pool', name: 'Poolside', commands: ['pool'], args: ['acp'] }
]

export async function agentSearchPaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): Promise<string[]> {
  const paths = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)
  paths.push(join(home, '.local/bin'), join(home, '.npm-global/bin'), join(home, '.bun/bin'),
    join(home, '.volta/bin'), join(home, '.cargo/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
    join(home, '.local/share/pnpm'), join(home, 'Library/pnpm'), join(home, '.antigravity/bin'),
    join(home, '.local/share/mise/shims'))
  if (env.APPDATA) paths.push(join(env.APPDATA, 'npm'))
  if (env.LOCALAPPDATA) paths.push(join(env.LOCALAPPDATA, 'Microsoft/WinGet/Links'), join(env.LOCALAPPDATA, 'Programs/Antigravity/bin'))
  if (env.ProgramFiles) paths.push(join(env.ProgramFiles, 'nodejs'))
  for (const root of [join(home, '.nvm/versions/node'), join(home, '.local/share/fnm/node-versions')]) {
    const versions = await readdir(root).catch(() => [])
    for (const version of versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      paths.push(join(root, version, 'bin'), join(root, version, 'installation/bin'))
    }
  }
  // A few editors install standalone adapters in their own bounded cache trees.
  const roots = [join(home, 'Library/Application Support/Zed/external_agents'), join(home, '.local/share/zed/external_agents')]
  const walk = async (root: string, depth: number): Promise<void> => {
    paths.push(root)
    if (!depth) return
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) await walk(join(root, entry.name), depth - 1)
    }
  }
  for (const root of roots) await walk(root, 3)
  return [...new Set(paths)]
}

export async function findExecutable(command: string, paths: string[], platform = process.platform): Promise<string | undefined> {
  const names = platform === 'win32' && !/\.(exe|cmd|bat|com)$/i.test(command)
    ? [command + '.exe', command + '.cmd', command + '.bat', command] : [command]
  const candidates = isAbsolute(command) ? names : paths.flatMap((path) => names.map((name) => join(path, name)))
  for (const candidate of candidates) {
    try {
      await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      if ((await stat(candidate)).isFile()) return candidate
    } catch { /* Not installed in this directory. */ }
  }
  return undefined
}

export async function detectAgents(paths?: string[]): Promise<DetectedAgent[]> {
  const search = paths ?? await agentSearchPaths()
  const find = async (commands: string[]) => {
    for (const command of commands) { const result = await findExecutable(command, search); if (result) return result }
    return undefined
  }
  const npx = await find(['npx'])
  return Promise.all(agentProfiles.map(async (profile): Promise<DetectedAgent> => {
    const executable = await find(profile.commands)
    const cli = executable ?? await find(profile.cli ?? [])
    const launch = executable ? { ...emptyAcpConfig, command: executable, args: profile.args, env: profile.env ?? {} } :
      cli && profile.adapter && npx ? { ...emptyAcpConfig, command: npx, args: ['-y', '--package', profile.adapter.package, '--', profile.adapter.bin] } : undefined
    return {
      id: profile.id, name: profile.name, executable: cli,
      status: executable ? 'available' : cli ? (launch ? 'adapter-needed' : 'cli-only') : 'not-found',
      launch,
      installHint: profile.adapter ? `npm install -g ${profile.adapter.package}` : undefined,
      website: profile.website ?? 'https://github.com/agentclientprotocol/registry'
    }
  }))
}
