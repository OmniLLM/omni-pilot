// OmniPilot agent primitives — Tool.
//
// A Tool is a plain shape with { name, description, parameters, dispatch, meta }.
// Concatenated into dist/background.js; do not add `export`s.
//
// Factory over class: keeps vm.runInContext tests simple (no `new`).

function createTool({ name, description, parameters, dispatch, meta = {} }) {
  if (!name || typeof name !== 'string') throw new Error('Tool.name is required');
  if (typeof dispatch !== 'function') throw new Error(`Tool ${name}.dispatch must be a function`);
  return {
    name,
    description: description || '',
    parameters: parameters || { type: 'object', properties: {}, additionalProperties: false },
    dispatch,
    meta
  };
}
