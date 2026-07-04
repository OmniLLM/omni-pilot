// OmniPilot agent primitives — A2aToolProvider.
//
// Wraps discovered A2A servers as ToolRegistry entries. One Tool per
// skill (if the agent card advertises them), otherwise one Tool per
// server. Each tool's dispatch delegates via the existing
// `delegateA2aTask` free function (still in index.mjs; moved when we
// slice out the delegation module later).

function registerA2aToolsInRegistry(registry, servers, options = {}) {
  const uniqueName = createUniqueNameGenerator(registry);
  const { getContextText } = options;

  for (const server of servers) {
    const skills = Array.isArray(server.agentCard?.skills)
      ? server.agentCard.skills.filter(skill => skill && typeof skill === 'object' && (skill.id || skill.name))
      : [];

    if (skills.length) {
      for (const skill of skills) {
        const skillId = String(skill.id || skill.name);
        const name = uniqueName(buildA2aToolName(server.id, skillId));
        registry.register(createTool({
          name,
          description: buildA2aSkillToolDescription(server, skill),
          parameters: buildA2aToolParameters(),
          dispatch: async ({ task }) => delegateA2aTask({
            serverId: server.id,
            task: String(task || '').trim(),
            contextText: getContextText ? getContextText() : ''
          }),
          meta: {
            serverId: server.id,
            skillId,
            skillName: skill.name || skill.id || '',
            skillDescription: skill.description || '',
            skillTags: Array.isArray(skill.tags) ? skill.tags : []
          }
        }));
      }
      continue;
    }

    const name = uniqueName(buildA2aToolName(server.id));
    registry.register(createTool({
      name,
      description: buildA2aServerToolDescription(server),
      parameters: buildA2aToolParameters(),
      dispatch: async ({ task }) => delegateA2aTask({
        serverId: server.id,
        task: String(task || '').trim(),
        contextText: getContextText ? getContextText() : ''
      }),
      meta: {
        serverId: server.id,
        skillId: null,
        skillName: '',
        skillDescription: '',
        skillTags: []
      }
    }));
  }
}

function createUniqueNameGenerator(registry) {
  const used = new Set(registry.list().map(tool => tool.name));
  return baseName => {
    let name = baseName;
    let suffix = 2;
    while (used.has(name)) {
      name = `${baseName}_${suffix}`;
      suffix += 1;
    }
    used.add(name);
    return name;
  };
}
