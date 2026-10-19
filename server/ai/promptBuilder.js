// Fills {{placeholder}} tokens in a prompt template with real values.
//
// Templates are stored as plain text in the prompt_templates table (see
// server/db/migrations/001_ai_content_module.sql) and are NEVER executed as code --
// this function only ever does straightforward string substitution. There is no eval,
// no code execution, no way for a stored template to do anything beyond producing a
// final text string that gets sent to the AI provider as a prompt.

/**
 * Replaces every {{key}} in the template with variables[key], if present.
 * Unmatched placeholders are left as-is in the output (visible, not silently dropped)
 * so a missing variable is obvious to whoever reviews the generated draft, rather than
 * quietly producing a prompt with a gap in it.
 */
function buildPrompt(templateText, variables = {}) {
  if (typeof templateText !== 'string') {
    throw new Error('templateText must be a string.');
  }
  return templateText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(variables, key) && variables[key] != null) {
      return String(variables[key]);
    }
    return match; // leave {{unresolved_key}} visible rather than silently blank
  });
}

/**
 * Returns the list of {{placeholder}} names referenced in a template, useful for the
 * admin UI to show "this template expects: topic, tone, audience" before generation.
 */
function extractPlaceholders(templateText) {
  if (typeof templateText !== 'string') return [];
  const matches = templateText.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g);
  const names = new Set();
  for (const m of matches) names.add(m[1]);
  return Array.from(names);
}

module.exports = { buildPrompt, extractPlaceholders };
