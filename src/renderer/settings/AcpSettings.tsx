import React from 'react'
import type { AcpLaunchConfig, DetectedAgent } from '@shared/acp'
import { emptyAcpConfig, normalizeAcpConfig } from '@shared/acp'
import type { ProviderTemplate } from '@shared/types'
import './acp.css'

export function AcpDiscovery({ zh, onAdd }: { zh: boolean; onAdd: (agent?: DetectedAgent) => void }) {
  const [agents, setAgents] = React.useState<DetectedAgent[]>([])
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const [expanded, setExpanded] = React.useState(false)
  const scan = async () => {
    setBusy(true); setError('')
    try { setAgents(await window.assistantLite.acp.detect()) }
    catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  React.useEffect(() => { void scan() }, [])
  const found = agents.filter((agent) => agent.status !== 'not-found')
  const labels = zh ? { available: '发现 ACP 入口 · 待测试', 'adapter-needed': '发现 CLI · 需要适配器', 'cli-only': '发现 CLI · 请配置 ACP 入口', 'not-found': '未发现' } :
    { available: 'ACP entry found · Not tested', 'adapter-needed': 'CLI found · Adapter needed', 'cli-only': 'CLI found · Configure ACP entry', 'not-found': 'Not found' }
  return <section className="acp-discovery" aria-label={zh ? '本地 Agent 检测' : 'Local agent discovery'}>
    <div className="acp-discovery-head"><div><h3>{zh ? '连接本地 Agent' : 'Connect a local agent'}</h3>
      <p>{zh ? '使用已登录的 CLI 账户，通过 ACP stdio 调用；扫描只检查文件，不启动程序。' : 'Use your signed-in CLI through ACP stdio. Scanning checks files without starting programs.'}</p></div>
      <button className="inline-action-button" onClick={() => void scan()} disabled={busy}>{busy ? (zh ? '扫描中…' : 'Scanning…') : (zh ? '重新检测' : 'Scan again')}</button></div>
    {(expanded ? found : found.slice(0, 3)).map((agent) => <div className="acp-agent-row" key={agent.id}><div><strong>{agent.name}</strong><span>{labels[agent.status]}</span><code title={agent.executable}>{agent.executable}</code>
      {agent.status === 'cli-only' && <small>{agent.installHint ?? (zh ? '安装该产品的 ACP 服务后，使用自定义配置添加。' : 'Install its ACP server, then add a custom configuration.')}</small>}</div>
      {agent.launch && <button className="inline-action-button" onClick={() => onAdd(agent)}>{agent.status === 'adapter-needed' ? (zh ? '添加（首次下载适配器）' : 'Add (downloads adapter)') : (zh ? '添加到服务' : 'Add provider')}</button>}</div>)}
    {!busy && !found.length && <p className="acp-empty">{zh ? '没有在常见路径找到 Agent。可安装 CLI 后重新检测，或填写可执行文件的完整路径。' : 'No agents found in common paths. Install a CLI and scan again, or enter its full executable path.'}</p>}
    {error && <p role="alert" className="acp-error">{error}</p>}
    {found.length > 3 && <button className="inline-action-button acp-expand" onClick={() => setExpanded(!expanded)}>{expanded ? (zh ? '收起列表' : 'Show fewer') :
      (zh ? `查看其余 ${found.length - 3} 个 Agent` : `Show ${found.length - 3} more agents`)}</button>}
    <div className="acp-discovery-footer"><button className="inline-action-button" onClick={() => onAdd()}>{zh ? '+ 自定义 ACP 服务' : '+ Custom ACP provider'}</button>
      {agents.length > 0 && <details><summary>{zh ? `检测目录 · ${agents.length} 种 Agent` : `Catalog · ${agents.length} agents`}</summary><p>{agents.map((agent) => `${agent.name}${agent.status !== 'not-found' ? ' ✓' : ''}`).join(' · ')}</p></details>}</div>
  </section>
}

function JsonField({ label, value, kind, onSave }: { label: string; value: unknown; kind: 'array' | 'env'; onSave: (value: any) => void }) {
  const serialized = JSON.stringify(value, null, 2)
  const [draft, setDraft] = React.useState(serialized)
  const [error, setError] = React.useState('')
  React.useEffect(() => { setDraft(serialized) }, [serialized])
  const save = () => {
    try {
      const next = JSON.parse(draft)
      if (kind === 'array' ? !Array.isArray(next) || !next.every((item) => typeof item === 'string') :
        !next || typeof next !== 'object' || Array.isArray(next) || !Object.entries(next).every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string')) throw new Error('Invalid JSON shape')
      setError(''); onSave(next)
    } catch { setError(kind === 'array' ? 'JSON: ["arg1", "arg2"]' : 'JSON: {"ENV_NAME": "value"}') }
  }
  return <label className="field"><span>{label}</span><textarea value={draft} rows={kind === 'array' ? 3 : 2} spellCheck={false} onChange={(event) => setDraft(event.target.value)} onBlur={save} aria-invalid={!!error} />{error && <small className="acp-error" role="alert">{error}</small>}</label>
}

export function AcpFields({ template, zh, onChange }: { template: ProviderTemplate; zh: boolean; onChange: (config: AcpLaunchConfig) => void }) {
  const config = normalizeAcpConfig(template.provider.acp)
  const patch = (value: Partial<AcpLaunchConfig>) => onChange({ ...config, ...value })
  return <div className="acp-fields">
    <p className="acp-note">{zh ? '复用 Agent 自己的登录和模型配置，无需在 AIA 填写 API Key。请先在终端完成该 Agent 的登录。' : 'Uses the agent’s own login and model configuration. No AIA API key required. Sign in to the agent in a terminal first.'}</p>
    <label className="field"><span>{zh ? 'ACP 可执行文件' : 'ACP executable'}</span><input value={config.command} placeholder="/path/to/agent-acp" onChange={(event) => patch({ command: event.target.value })} spellCheck={false} /></label>
    <JsonField label={zh ? '启动参数（JSON 字符串数组）' : 'Arguments (JSON string array)'} value={config.args} kind="array" onSave={(args) => patch({ args })} />
    <label className="field"><span>{zh ? '工作目录（留空使用 AIA 独立目录）' : 'Working directory (blank = AIA workspace)'}</span><input value={config.cwd} onChange={(event) => patch({ cwd: event.target.value })} placeholder={zh ? '已有目录的绝对路径' : 'Absolute path to an existing directory'} spellCheck={false} /></label>
    <label className="field"><span>{zh ? 'Agent 工具权限请求' : 'Agent tool permission requests'}</span><select value={config.permissionMode} onChange={(event) => patch({ permissionMode: event.target.value as 'deny' | 'ask' })}>
      <option value="deny">{zh ? '自动拒绝（默认）' : 'Deny (default)'}</option><option value="ask">{zh ? '每次弹窗确认，仅允许一次' : 'Ask each time; allow once only'}</option></select></label>
    <details><summary>{zh ? '高级：子进程环境变量' : 'Advanced: process environment'}</summary><JsonField label={zh ? '仅在本机保存；避免填写明文密钥' : 'Stored locally; avoid plaintext secrets'} value={config.env} kind="env" onSave={(env) => patch({ env })} /></details>
    <p className="acp-note">{zh ? '参数按数组传递，不是 shell 命令。首次使用 npx 适配器会联网下载。AIA 不提供文件／终端工具；Agent 自有工具仍受它自身的权限与沙箱配置控制。联网搜索与思考强度由 Agent 管理。' : 'Arguments are an array, not a shell command. npx adapters download on first use. AIA provides no file/terminal tools; agent-owned tools follow its own permission and sandbox settings. The agent controls web search and reasoning.'}</p>
  </div>
}

export function acpTemplate(agent?: DetectedAgent): ProviderTemplate {
  return { id: crypto.randomUUID(), name: agent?.name ?? 'ACP Agent', provider: {
    apiType: 'acp', baseUrl: '', apiKey: '', model: '', temperature: 1, acp: agent?.launch ?? { ...emptyAcpConfig }
  } }
}
