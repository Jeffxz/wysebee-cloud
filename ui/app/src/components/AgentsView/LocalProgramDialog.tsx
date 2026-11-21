import { useState } from "react";
import { useTranslation } from "react-i18next";
import { btn, cn, inputBase, muted } from "@shared/cn";
import { cleaned, problemOf, splitCommand, type LocalProgram, type LocalProgramArg } from "../../cloud/localPrograms";
import { ArgsEditor, NameFields, ProgramModal } from "./ProgramFields";

/**
 * Making (or changing) a "Run local program" tool: its name, what it does (the agent reads this to
 * know when to use it), the program and its arguments, each fixed text or a blank the agent
 * fills in. Saved at once as one of the person's tools (ToolCards).
 *
 * The program is **typed**: there is no Browse… here, since a page cannot pick a file on the
 * computer. It runs on the computer paired with this agent (a Mac or a Windows PC), through
 * Wysebee Agent — never here — and only once the person has allowed it there, which is also
 * when that computer checks that it exists.
 */
export function LocalProgramDialog({
  initial,
  draft,
  others,
  onSave,
  onClose,
}: {
  /** The tool being changed; none for a new one. */
  initial?: LocalProgram;
  /** A new tool's starting values (a ready-made one from the Tool library), to look at first. */
  draft?: LocalProgram;
  /** The other tools, whose names this one must not take. */
  others: LocalProgram[];
  onSave: (program: LocalProgram) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const start = initial ?? draft;
  const [name, setName] = useState(start?.name ?? "");
  const [description, setDescription] = useState(start?.description ?? "");
  const [command, setCommand] = useState(start?.command ?? "");
  const [args, setArgs] = useState<LocalProgramArg[]>(start?.args ?? []);
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    const program = cleaned({ name, description, command, args });
    const wrong = problemOf(program, others);
    if (wrong) return setProblem(t(wrong.key, wrong.values));
    onSave(program);
  };
  // A whole command line typed into Program ("open /Applications/Postman.app"): offer to
  // put the program there and each word after it in an argument row of its own.
  const words = splitCommand(command);
  const split = () => {
    setCommand(words[0]);
    setArgs((all) => [...words.slice(1).map((value) => ({ value })), ...all]);
    setProblem(null);
  };

  return (
    <ProgramModal
      title={t(initial ? "agents.tools.local.editTitle" : "agents.tools.local.addTitle")}
      intro={t("agents.tools.local.intro")}
      saveLabel={t(initial ? "agents.tools.local.saveEdit" : "agents.tools.local.saveAdd")}
      problem={problem}
      onSave={save}
      onClose={onClose}
      track="Local program save"
    >
      <NameFields idPrefix="local-program" name={name} onName={setName} description={description} onDescription={setDescription} />

      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor="local-program-command" className="font-medium">
          {t("agents.tools.local.command")}
        </label>
        <input id="local-program-command" className={cn(inputBase, "font-mono")} value={command} onChange={(e) => setCommand(e.target.value)} placeholder="git" />
        <span className={cn(muted, "text-[11px]")}>{t("agents.tools.local.commandHintWeb")}</span>
        {words.length > 1 && (
          <div role="note" className="mt-1 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span className="flex-1">{t("agents.tools.local.looksLikeLine", { program: words[0] })}</span>
            <button type="button" className={cn(btn, "text-xs")} onClick={split} data-track="Local program split command">
              {t("agents.tools.local.split")}
            </button>
          </div>
        )}
      </div>

      <ArgsEditor command={command} args={args} onArgs={setArgs} track="Local program add argument" />
    </ProgramModal>
  );
}
