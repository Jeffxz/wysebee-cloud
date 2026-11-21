/**
 * "Run local program" tools — a Mac agent's `program` tools (apps/cloud/user_tools.py): read,
 * and checked before the dialog saves one, as Wysebee Cloud checks them
 * (apps/cloud/agent_chat/mac.py `parse_one`). Whether the program exists is the Mac's to say, when
 * the person allows it in Wysebee Agent; nothing here runs anything. Pure, so it is tested on
 * its own.
 */

/** One argument: fixed text, or a blank the model fills. */
export type LocalProgramArg = { value: string } | { param: string; description: string };
export interface LocalProgram {
  name: string;
  description: string;
  command: string;
  args: LocalProgramArg[];
}

export const FIELD = "local_programs";
export const NAME = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_TEXT = 1000;
export const MAX_ARGS = 30;
export const MAX_PROGRAMS = 20;

const str = (v: unknown) => (typeof v === "string" ? v : "");

function argOf(v: unknown): LocalProgramArg | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.param === "string") return { param: o.param, description: str(o.description) };
  if (typeof o.value === "string") return { value: o.value };
  return null;
}

/** The programs in a config; an entry that cannot be read is left out. */
export function programsOf(value: unknown): LocalProgram[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== "object") return [];
    const o = v as Record<string, unknown>;
    const args = Array.isArray(o.args) ? o.args.map(argOf) : [];
    if (args.some((a) => a === null)) return [];
    return [{ name: str(o.name), description: str(o.description), command: str(o.command), args: args as LocalProgramArg[] }];
  });
}

/** What is wrong with a program about to be saved beside `others`: a translation key and
 * its values, or null when nothing is. */
export function problemOf(p: LocalProgram, others: LocalProgram[]): { key: string; values?: Record<string, string> } | null {
  if (!NAME.test(p.name)) return { key: "agents.tools.local.badName" };
  if (others.some((o) => o.name === p.name)) return { key: "agents.tools.local.nameTaken", values: { name: p.name } };
  if (!p.description.trim() || p.description.length > MAX_TEXT) return { key: "agents.tools.local.needDescription" };
  if (!p.command.trim()) return { key: "agents.tools.local.needCommand" };
  const blanks: string[] = [];
  for (const a of p.args) {
    if ("param" in a) {
      if (!NAME.test(a.param)) return { key: "agents.tools.local.badBlank" };
      if (blanks.includes(a.param)) return { key: "agents.tools.local.blankTaken", values: { name: a.param } };
      blanks.push(a.param);
    } else if (!a.value) {
      return { key: "agents.tools.local.emptyArg" };
    }
  }
  return null;
}

/** The program as it is saved: text trimmed, empty blank descriptions kept empty. */
export function cleaned(p: LocalProgram): LocalProgram {
  return {
    name: p.name.trim(),
    description: p.description.trim(),
    command: p.command.trim(),
    args: p.args.map((a) => ("param" in a ? { param: a.param.trim(), description: a.description.trim() } : { value: a.value })),
  };
}

/**
 * A command line cut into its words, as a shell would read them for this — spaces apart,
 * "double" or 'single' quotes keeping spaces together — so `open /Applications/Postman.app`
 * typed into Program can become the program `open` and the argument
 * `/Applications/Postman.app`. Nothing else of a shell's (no variables, no escapes).
 */
export function splitCommand(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: string | null = null;
  for (const c of line) {
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += c;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}
