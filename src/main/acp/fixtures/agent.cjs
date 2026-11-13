const { createInterface } = require('node:readline')
const input = createInterface({ input: process.stdin })
const mode = process.argv[2] || 'normal'
let promptId
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n')
const reply = (id, result) => send({ id, result })
const update = (value) => send({ method: 'session/update', params: { sessionId: 'session-test', update: value } })
input.on('line', (line) => {
  const m = JSON.parse(line)
  if (m.id === 'permission') {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(m.result.outcome) } })
    reply(promptId, { stopReason: 'end_turn' })
  }
  if (m.method === 'initialize') {
    if (mode === 'timeout') return
    if (mode === 'junk') { process.stdout.write('not ACP\n'); return }
    if (mode === 'exit') { process.exit(1); return }
    reply(m.id, { protocolVersion: mode === 'version' ? 2 : 1, authMethods: [{ id: 'terminal', name: 'CLI login' }],
      agentCapabilities: { promptCapabilities: { image: mode !== 'no-images' } } })
  }
  if (m.method === 'session/new') {
    if (mode === 'auth') { send({ id: m.id, error: { code: -32000, message: 'Authentication required' } }); return }
    reply(m.id, { sessionId: 'session-test', configOptions: mode === 'no-models' ? [] : [
      { id: 'model-id', category: 'model', type: 'select', options: [{ group: 'Models', options: [{ value: 'test-model', name: 'Test' }] }] }
    ] })
  }
  if (m.method === 'session/set_config_option') reply(m.id, {})
  if (m.method === 'session/prompt') {
    promptId = m.id
    if (mode === 'hang') return
    if (mode === 'permission') {
      send({ id: 'permission', method: 'session/request_permission', params: { sessionId: 'session-test', toolCall: { title: 'Write a file' },
        options: [{ optionId: 'once', kind: 'allow_once' }, { optionId: 'always', kind: 'allow_always' }, { optionId: 'reject', kind: 'reject_once' }] } })
      return
    }
    if (mode === 'echo') update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify(m.params.prompt) } })
    else {
      update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'Thinking' } })
      const bytes = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: {
        sessionId: 'session-test', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '你好 ACP' } }
      } }) + '\n')
      const index = bytes.indexOf(Buffer.from('你好')) + 1
      process.stdout.write(bytes.subarray(0, index))
      setTimeout(() => { process.stdout.write(bytes.subarray(index)); reply(m.id, { stopReason: 'end_turn' }) }, 5)
      return
    }
    reply(m.id, { stopReason: 'end_turn' })
  }
})
