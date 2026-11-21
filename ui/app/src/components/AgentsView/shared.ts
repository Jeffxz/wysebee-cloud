

// Config keys the agent editor handles explicitly. Everything else in the config
// document is preserved untouched on save (see AgentConfigPanel's `rest`).
export const CREATOR_FIELD = "creator";

// Free-text display label for the agent (shown/edited in the Agents panel).
export const LABEL_FIELD = "label";

// The agent's picture: an emoji, or a picture as a data URL.
export const AVATAR_FIELD = "avatar";

// Authored tools an agent used to name. Gone (agents work in the browser); the panel
// only drops the key from what it saves, so a stale one is never written back.
export const TOOLS_FIELD = "tools";

// This agent's access gate, inline: {mode, users, conditions, condition_logic}.
// Absent, or without a `mode`, means the agent is open to anyone.
//
// **The agent's own configuration, not a reference to a shared object.** It used to
// be AUTHORIZATION_FIELD below — the name of an "Authorization"-type tool — which
// made the gate a tool it never behaved like: never offered to a caller's model,
// never listed among an agent's tools, and excluded by hand from every picker that
// shows tools.
//
// Must match agent_config.AUTHORIZATION_CONFIG_FIELD on the backend exactly.
export const AUTHORIZATION_CONFIG_FIELD = "authorization";

// **Legacy.** The name of an Authorization-type tool, from before the gate moved
// inline. Nothing writes it; the panel reads it only to show an agent saved with one
// as gated, and the backend still honours it until that agent is saved again.
export const AUTHORIZATION_FIELD = "authorization_tool";

// A key an agent's config carried in an older version (where its shell ran). Nothing
// reads it now; the panel only drops it from what it saves, so a stale one is never
// written back.
export const WORKSPACE_FIELD = "workspace";

// The database connection and its write switch an agent used to have. Gone with
// database access; dropped on save like TOOLS_FIELD.
export const DATABASE_FIELD = "database";

export const DATABASE_WRITE_FIELD = "database_write";

// Folders on this computer the agent may use, outside any sandbox. Absent = none.
export const LOCAL_FOLDERS_FIELD = "local_folders";

// The owner's markdown instructions for the agent (the Instruction tab), added to its
// system prompt for every chat. Absent = none.
export const INSTRUCTIONS_FIELD = "instructions";

// The browser's switches, as an agent's settings hold them.
export const BROWSER_ACCESS_FIELD = "browser_access";
export const BROWSER_DEVTOOLS_FIELD = "browser_devtools";
/** The folders a Mac agent may use (Local Folder), as its Mac said them: written only by
 * Wysebee Cloud, picked in Wysebee Agent for Mac. */
export const MAC_FOLDERS_FIELD = "mac_folders";

