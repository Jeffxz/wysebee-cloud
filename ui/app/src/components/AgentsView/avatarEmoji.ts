// Curated avatar emoji for the agent picker. An agent is a named bundle of tools
// exposed to an LLM, so the set leans on what an agent *does* — data, search,
// tooling, infra, comms — rather than on faces or moods. 48 entries, six rows of
// eight in the picker grid; anything else goes in the free-text field beside it.
export const AVATAR_EMOJI: readonly string[] = [
  // Agents and brains
  "🤖", "🧠", "✨", "🪄", "👾", "🦾", "🐝", "🎯",
  // Roles
  "🧑‍💻", "🕵️", "🧑‍🏫", "🧑‍🔬", "🧑‍⚖️", "🧑‍⚕️", "💁", "🤝",
  // Data and analytics
  "📊", "📈", "📉", "🧮", "🗂️", "🗃️", "🧾", "🔢",
  // Knowledge and search
  "🔍", "📚", "📝", "📖", "💡", "🧭", "🏷️", "❓",
  // Tools and ops
  "🔧", "🛠️", "⚙️", "🧰", "🧪", "🔌", "⚡", "🚀",
  // Infrastructure, comms, security
  "🗄️", "🖥️", "☁️", "🌐", "💬", "📨", "🔐", "🔑",
];
