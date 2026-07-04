// OmniPilot agent primitives — ToolRegistry.
//
// Owns a Map<name, Tool>. The single choke point for tool execution:
// phase 4 will wrap dispatch with guardrails; phase 5 will emit audit
// events here.

function createToolRegistry() {
  const tools = new Map();

  function register(tool) {
    if (!tool || typeof tool !== 'object') throw new Error('register(tool): tool required');
    if (tools.has(tool.name)) throw new Error(`Tool "${tool.name}" already registered`);
    tools.set(tool.name, tool);
  }

  function get(name) {
    return tools.get(name);
  }

  function list() {
    return Array.from(tools.values());
  }

  async function dispatch(name, args) {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return await tool.dispatch(args || {});
  }

  function schemasFor(apiShape) {
    return list().map(tool => toolSchemaForApiShape(tool, apiShape));
  }

  return { register, get, list, dispatch, schemasFor };
}

function toolSchemaForApiShape(tool, apiShape) {
  if (apiShape === 'anthropic-messages') {
    return { name: tool.name, description: tool.description, input_schema: tool.parameters };
  }
  if (apiShape === 'openai-responses') {
    return { type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters };
  }
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}
