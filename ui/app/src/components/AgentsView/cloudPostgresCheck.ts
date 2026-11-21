/**
 * A PostgreSQL connection of an agent living in Wysebee Cloud, checked before the dialog
 * saves it — the server's rules (apps/cloud/agent_chat/postgres.py `parse`), so most
 * mistakes are said at once. Whether the host's address is public is the server's to tell.
 * Pure, so it is tested on its own.
 */

import type { CloudPostgresIn } from "../../api";

export const MAX_CLOUD_POSTGRES = 10;
export const DEFAULT_PORT = 5432;
export const MAX_DESCRIPTION = 1000;

const word = (v: string, max: number) => v.length > 0 && v.length <= max && !/\s/.test(v);

/** What is wrong with a connection named `name` beside the agent's `others`: a translation key, or null. */
export function cloudPostgresProblemOf(name: string, c: CloudPostgresIn, others: string[]): string | null {
  if (!/^[a-z][a-z0-9_]{0,29}$/.test(name)) return "agents.tools.postgres.badName";
  if (others.includes(name)) return "agents.tools.postgres.taken";
  if (!word(c.host, 255) || !/^[A-Za-z0-9.\-:]+$/.test(c.host)) return "agents.tools.postgres.badHost";
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) return "agents.tools.postgres.badPort";
  if (!word(c.database, 63)) return "agents.tools.postgres.badDatabase";
  if (!word(c.user, 255)) return "agents.tools.postgres.badUser";
  if (c.description.length > MAX_DESCRIPTION) return "agents.tools.postgres.tooLong";
  return null;
}
