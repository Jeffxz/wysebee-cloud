/**
 * A Snowflake connection of an agent living in Wysebee Cloud, checked before the dialog
 * saves it — the server's rules (apps/cloud/agent_chat/snowflake.py `parse`), so most
 * mistakes are said at once. Pure, so it is tested on its own.
 */

import type { CloudSnowflakeIn } from "../../api";
import { MAX_DESCRIPTION } from "./cloudPostgresCheck";

export const MAX_CLOUD_SNOWFLAKE = 10;

/** A word of a connection: no spaces, at most 255 characters; empty only when not needed. */
const word = (v: string, needed: boolean) => (v.length > 0 || !needed) && v.length <= 255 && !/\s/.test(v);

/** What is wrong with a connection named `name` beside the agent's `others`: a translation
 * key, or null. `stored` says a token or key is already kept for it, in the way it signs in. */
export function cloudSnowflakeProblemOf(name: string, c: CloudSnowflakeIn, others: string[], stored: boolean): string | null {
  if (!/^[a-z][a-z0-9_]{0,29}$/.test(name)) return "agents.tools.postgres.badName";
  if (others.includes(name)) return "agents.tools.postgres.taken";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(c.account)) return "agents.tools.snowflake.badAccount";
  if (!word(c.database, true)) return "agents.tools.postgres.badDatabase";
  if (!word(c.warehouse, false) || !word(c.schema, false) || !word(c.role, false)) return "agents.tools.snowflake.badWord";
  if (!word(c.user, c.auth === "key")) return "agents.tools.snowflake.badUser";
  if (!c.secret && !stored) return c.auth === "key" ? "agents.tools.snowflake.noKey" : "agents.tools.snowflake.noToken";
  if (c.description.length > MAX_DESCRIPTION) return "agents.tools.postgres.tooLong";
  return null;
}
