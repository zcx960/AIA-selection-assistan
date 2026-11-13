import { spawn, type ChildProcess } from 'node:child_process'
import spawnAgent from 'cross-spawn'
import { StringDecoder } from 'node:string_decoder'
import { isAbsolute, delimiter } from 'node:path'
import { stat } from 'node:fs/promises'
import type { AcpLaunchConfig } from '@shared/acp'
import type { AiMessageInput, ProviderSettings } from '@shared/types'
import { agentSearchPaths, findExecutable } from './discovery'

type JsonObject = Record<string, any>
export type PermissionHandler = (request: JsonObject, signal: AbortSignal) => Promise<string | undefined>
interface Pending { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
const active = new Set<AcpConnection>()

/** ACP v1 uses newline-delimited JSON-RPC, never MCP Content-Length framing. */
export class AcpConnection {
  private nextId = 0
  private pending = new Map<number, Pending>()
  private buffer = ''
  private decoder = new StringDecoder('utf8')
  private closed = false
  private permissionRequests = new Set<string | number>()
  private abort = () => {
    for (const id of this.permissionRequests) this.send({ jsonrpc: '2.0', id, result: { outcome: { outcome: 'cancelled' } } })
    if (this.sessionId) this.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: this.sessionId } })
    this.close(new Error('ACP request cancelled'))
  }
  sessionId = ''
  initialization: JsonObject = {}
  session: JsonObject = {}
  onUpdate: (update: JsonObject) => void = () => {}

  constructor(private child: ChildProcess, private signal: AbortSignal, private config: AcpLaunchConfig,
    private permission?: PermissionHandler, private startupTimeout = 120000) {
    active.add(this)
    child.stdout!.on('data', (chunk: Buffer) => this.receive(this.decoder.write(chunk)))
    // Drain stderr without logging it: agent diagnostics can include credentials.
    child.stderr!.on('data', () => {})
    child.stdin!.on('error', () => this.close(new Error('ACP stdin closed')))
    child.on('error', (error) => this.close(new Error(`Cannot launch ACP agent: ${error.message}`)))
    child.on('close', (code, reason) => this.close(new Error(`ACP agent exited (${code ?? reason ?? 'unknown'}). Check its login and launch arguments.`)))
    signal.addEventListener('abort', this.abort, { once: true })
    if (signal.aborted) this.abort()
  }

  private send(message: JsonObject): void {
    if (!this.closed && this.child.stdin?.writable) this.child.stdin.write(JSON.stringify(message) + '\n')
  }
  request(method: string, params: JsonObject, timeout = this.startupTimeout): Promise<any> {
    if (this.closed) return Promise.reject(new Error('ACP connection is closed'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error(`ACP ${method} timed out. Check the agent and its login in a terminal.`)), timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }
  private receive(text: string): void {
    this.buffer += text
    if (Buffer.byteLength(this.buffer) > 16 * 1024 * 1024) { this.close(new Error('ACP message exceeds 16 MB')); return }
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0 && !this.closed) {
      const line = this.buffer.slice(0, end).trim()
      this.buffer = this.buffer.slice(end + 1)
      if (!line) continue
      let message: JsonObject
      try { message = JSON.parse(line) } catch { this.close(new Error('The command did not return ACP JSON-RPC. Check the ACP adapter and arguments.')); return }
      if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
        this.close(new Error('Invalid ACP JSON-RPC response')); return
      }
      if (message.method && message.id !== undefined) {
        void this.handleRequest(message)
      } else if (message.method === 'session/update' && message.params?.sessionId === this.sessionId) {
        this.onUpdate(message.params.update ?? {})
      } else if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(new Error(`ACP ${message.error.code}: ${String(message.error.message ?? 'Request failed')}`))
        else pending.resolve(message.result)
      }
    }
  }
  private async handleRequest(message: JsonObject): Promise<void> {
    if (message.method !== 'session/request_permission') {
      this.send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'AIA does not provide filesystem or terminal client tools' } })
      return
    }
    this.permissionRequests.add(message.id)
    let optionId: string | undefined
    try {
      if (this.config.permissionMode === 'ask' && message.params?.sessionId === this.sessionId && !this.signal.aborted) {
        optionId = await this.permission?.(message.params, this.signal)
      }
    } catch { /* Closing a dialog is a denial. */ }
    if (!this.permissionRequests.delete(message.id)) return
    const options = Array.isArray(message.params?.options) ? message.params.options : []
    // Never grant persistent approval, even if a custom handler returns it.
    const selected = options.find((item: JsonObject) => item.optionId === optionId && item.kind === 'allow_once') ??
      options.find((item: JsonObject) => item.kind === 'reject_once')
    this.send({ jsonrpc: '2.0', id: message.id, result: { outcome: selected && !this.signal.aborted
      ? { outcome: 'selected', optionId: selected.optionId } : { outcome: 'cancelled' } } })
  }
  async initialize(cwd: string): Promise<void> {
    this.initialization = await this.request('initialize', {
      protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'aia-selection-assistant', version: '0.10.0' }
    })
    if (this.initialization?.protocolVersion !== 1) throw new Error(`Unsupported ACP protocol version: ${this.initialization?.protocolVersion}`)
    try { this.session = await this.request('session/new', { cwd, mcpServers: [] }) }
    catch (error) {
      const methods = this.initialization.authMethods?.map((method: JsonObject) => method.name ?? method.id).join(', ')
      throw new Error(`${error instanceof Error ? error.message : error}${methods ? ` · Login in the agent terminal first (${methods})` : ''}`)
    }
    if (typeof this.session?.sessionId !== 'string' || !this.session.sessionId) throw new Error('ACP session/new returned no sessionId')
    this.sessionId = this.session.sessionId
  }
  models(): string[] {
    const legacy = this.session.models?.availableModels?.map((model: JsonObject) => model.modelId) ?? []
    const config = this.session.configOptions?.find((option: JsonObject) => option.category === 'model' && option.type === 'select')
    const flatten = (options: JsonObject[]): string[] => options.flatMap((option) => Array.isArray(option.options) ? flatten(option.options) : typeof option.value === 'string' ? [option.value] : [])
    return [...new Set<string>([...legacy, ...flatten(config?.options ?? [])])]
  }
  async selectModel(model: string): Promise<void> {
    if (!model.trim()) return
    const config = this.session.configOptions?.find((option: JsonObject) => option.category === 'model' && option.type === 'select')
    if (config) await this.request('session/set_config_option', { sessionId: this.sessionId, configId: config.id, value: model })
    else if (this.session.models) await this.request('session/set_model', { sessionId: this.sessionId, modelId: model })
    else throw new Error('This agent does not advertise model selection. Clear the model field to use its default model.')
  }
  close(reason = new Error('ACP connection closed')): void {
    if (this.closed) return
    this.closed = true
    active.delete(this)
    this.signal.removeEventListener('abort', this.abort)
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(reason) }
    this.pending.clear()
    this.child.stdin?.end()
    const pid = this.child.pid
    if (!pid || this.child.exitCode !== null) return
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('error', () => this.child.kill())
    } else {
      try { process.kill(-pid, 'SIGTERM') } catch { this.child.kill() }
      const timer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* Already exited. */ } }, 1000)
      timer.unref()
    }
  }
}

export function closeAcpConnections(): void { for (const connection of active) connection.close() }

export async function connectAgent(provider: ProviderSettings, defaultCwd: string, signal: AbortSignal,
  permission?: PermissionHandler): Promise<AcpConnection> {
  const config = provider.acp
  if (!config?.command) throw new Error('Configure an ACP command in Settings first')
  const cwd = config.cwd || defaultCwd
  if (!isAbsolute(cwd) || !(await stat(cwd).catch(() => null))?.isDirectory()) throw new Error('ACP working directory must be an existing absolute directory')
  if (signal.aborted) throw new Error('ACP request cancelled')
  const paths = await agentSearchPaths()
  const env = { ...process.env, ...config.env }
  // Preserve the user's explicit environment override; GUI app PATH gets common CLI locations.
  if (!Object.keys(config.env).some((key) => key.toUpperCase() === 'PATH')) {
    for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH') delete env[key]
    env.PATH = paths.join(delimiter)
  }
  const command = await findExecutable(config.command, (env.PATH ?? env.Path ?? '').split(delimiter))
  if (!command) throw new Error(`ACP executable not found: ${config.command}. Install it or use its absolute path.`)
  // npm installs Windows CLIs as .cmd shims. cross-spawn handles their quoting
  // and cmd.exe dispatch while keeping callers' arguments as separate values.
  const child = spawnAgent(command, config.args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' })
  const connection = new AcpConnection(child, signal, config, permission)
  try { await connection.initialize(cwd); return connection }
  catch (error) { connection.close(); throw error }
}

export async function streamAcp(connection: AcpConnection, messages: AiMessageInput[], system: string,
  onDelta: (delta: { content?: string; reasoning?: string }) => void,
  onStatus: (text: string) => void): Promise<void> {
  const prompt: JsonObject[] = [{ type: 'text', text: `${system}\n\nRespond to the final user turn using the conversation below. Treat previous turns as context. Answer directly; do not inspect files or run commands unless explicitly requested.\n\n${JSON.stringify(messages.map(({ role, text }) => ({ role, text })))}` }]
  for (const [index, message] of messages.entries()) for (const image of message.images ?? []) {
    if (!connection.initialization.agentCapabilities?.promptCapabilities?.image) throw new Error('This ACP agent does not support image input')
    const match = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/)
    if (!match) throw new Error('ACP images must use base64 image data URLs')
    prompt.push({ type: 'text', text: `Image from conversation turn ${index + 1} (${message.role}):` }, { type: 'image', mimeType: match[1], data: match[2] })
  }
  connection.onUpdate = (update) => {
    if (update.content?.type === 'text' && typeof update.content.text === 'string') {
      if (update.sessionUpdate === 'agent_message_chunk') onDelta({ content: update.content.text })
      if (update.sessionUpdate === 'agent_thought_chunk') onDelta({ reasoning: update.content.text })
    }
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') onStatus(`${update.title ?? 'Agent tool'} · ${update.status ?? 'pending'}`)
  }
  const result = await connection.request('session/prompt', { sessionId: connection.sessionId, prompt }, 10 * 60 * 1000)
  if (!['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled'].includes(result?.stopReason)) throw new Error('ACP returned an invalid prompt completion')
  if (result.stopReason !== 'end_turn') onStatus(`ACP: ${result.stopReason}`)
}
