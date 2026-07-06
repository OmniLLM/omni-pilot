// OmniPilot agent primitives — A2aToolProvider.
//
// Wraps discovered A2A servers as ToolRegistry entries. For standalone
// A2A agents: one Tool per skill (or one per server if no skills). For
// hub-style composite cards (agent-integration-guide.md §2): individual
// tools for plugin:tool:* and a single meta-tool for skill:*/plugin:query:*.

function registerA2aToolsInRegistry(registry, servers, options = {}) {
  const uniqueName = createUniqueNameGenerator(registry);
  const { getContextText } = options;

  for (const server of servers) {
    const skills = Array.isArray(server.agentCard?.skills)
      ? server.agentCard.skills.filter(skill => skill && typeof skill === 'object' && (skill.id || skill.name))
      : [];

    // Hub composite card: partition by flavour
    if (skills.length && isHubCompositeCard(server.agentCard)) {
      const { pluginTools, metaSkills } = partitionHubSkills(skills);

      // Register each plugin:tool:* as its own typed tool
      for (const skill of pluginTools) {
        const skillId = String(skill.id || skill.name);
        const name = uniqueName(buildA2aToolName(server.id, skillId));
        registry.register(createTool({
          name,
          description: buildA2aSkillToolDescription(server, skill),
          parameters: buildA2aToolParameters(),
          dispatch: async ({ task }) => delegateA2aTask({
            serverId: server.id,
            skillId,
            task: String(task || '').trim(),
            contextText: getContextText ? getContextText() : ''
          }),
          meta: {
            serverId: server.id,
            serverName: server.agentCard?.name || server.name || server.id,
            skillId,
            skillName: skill.name || skill.id || '',
            skillDescription: skill.description || '',
            skillTags: Array.isArray(skill.tags) ? skill.tags : []
          }
        }));
      }

      // Register one meta-tool for all skill:*/plugin:query:*/launcher:*
      if (metaSkills.length) {
        const metaName = uniqueName(buildA2aToolName(server.id, 'invoke_skill'));
        registry.register(createTool({
          name: metaName,
          description: buildHubMetaToolDescription(server, metaSkills),
          parameters: buildHubMetaToolParameters(metaSkills),
          dispatch: async ({ skill_id, task }) => delegateA2aTask({
            serverId: server.id,
            skillId: String(skill_id || '').trim(),
            task: String(task || '').trim(),
            contextText: getContextText ? getContextText() : ''
          }),
          meta: {
            serverId: server.id,
            serverName: server.agentCard?.name || server.name || server.id,
            skillId: null,
            skillName: 'invoke_skill',
            skillDescription: 'Hub meta-tool for skill:*/plugin:query:* calls',
            skillTags: [],
            isHubMetaTool: true
          }
        }));
      }
      continue;
    }

    // Standalone A2A agent: one tool per skill (existing behavior)
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
            skillId,
            task: String(task || '').trim(),
            contextText: getContextText ? getContextText() : ''
          }),
          meta: {
            serverId: server.id,
            serverName: server.agentCard?.name || server.name || server.id,
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
        serverName: server.agentCard?.name || server.name || server.id,
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
