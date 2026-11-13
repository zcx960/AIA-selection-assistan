export interface AcpLaunchConfig {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  /** Agent permissions are denied unless the user enables an explicit per-call prompt. */
  permissionMode: 'deny' | 'ask'
}

export interface DetectedAgent {
  id: string
  name: string
  status: 'available' | 'adapter-needed' | 'cli-only' | 'not-found'
  executable?: string
  launch?: AcpLaunchConfig
  installHint?: string
  website: string
}

export const emptyAcpConfig: AcpLaunchConfig = { command: '', args: [], cwd: '', env: {}, permissionMode: 'deny' }

export function normalizeAcpConfig(value: Partial<AcpLaunchConfig> | undefined): AcpLaunchConfig {
  return {
    command: typeof value?.command === 'string' ? value.command.trim() : '',
    args: Array.isArray(value?.args) ? value.args.filter((arg): arg is string => typeof arg === 'string') : [],
    cwd: typeof value?.cwd === 'string' ? value.cwd.trim() : '',
    env: value?.env && typeof value.env === 'object' && !Array.isArray(value.env)
      ? Object.fromEntries(Object.entries(value.env).filter(([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof item === 'string')) : {},
    permissionMode: value?.permissionMode === 'ask' ? 'ask' : 'deny'
  }
}
