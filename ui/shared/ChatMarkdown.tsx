import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Fenced-block languages drawn as something rather than shown as code. */
export const CHART_LANGUAGE = "d3";
export const EMAIL_LANGUAGE = "email-list";
export const CALENDAR_LANGUAGE = "calendar";
type Special = typeof CHART_LANGUAGE | typeof EMAIL_LANGUAGE | typeof CALENDAR_LANGUAGE;

/** The text of a hast node (a code block's contents). */
function textOf(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(textOf).join("");
}

/** A fenced block's language (when it is one of `languages`) and its text. */
function special(pre: unknown, languages: string[]): { language: Special; text: string } | null {
  const code = (pre as { children?: unknown[] } | undefined)?.children?.[0] as
    | { tagName?: string; properties?: { className?: unknown } }
    | undefined;
  if (code?.tagName !== "code") return null;
  const classes = code.properties?.className;
  const list = Array.isArray(classes) ? classes.map(String) : [];
  const language = languages.find((l) => list.includes(`language-${l}`));
  return language ? { language: language as Special, text: textOf(code).replace(/\n$/, "") } : null;
}

/**
 * A model's answer: GitHub-flavoured markdown (tables, strikethrough, task lists,
 * autolinks), with each ```d3 block drawn by `blocks.d3`, each ```email-list by
 * `blocks["email-list"]` and each ```calendar by `blocks.calendar` — the one place both apps' chats render model text, so they
 * read it the same way. A block with no renderer given is shown as code (an email's
 * own body is rendered with none: its text is not the model's to draw).
 */
export function ChatMarkdown({
  text,
  link,
  blocks = {},
}: {
  text: string;
  /** How a link opens — each app has its own way out. */
  link: (href: string | undefined, children: ReactNode) => ReactNode;
  blocks?: Partial<Record<Special, (text: string) => ReactNode>>;
}) {
  const languages = Object.keys(blocks);
  const components: Components = {
    a: ({ href, children }) => <>{link(href, children)}</>,
    pre: ({ node, children }) => {
      const block = special(node, languages);
      const render = block && blocks[block.language];
      return block && render ? <div className="my-1.5">{render(block.text)}</div> : <pre>{children}</pre>;
    },
  };
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </Markdown>
  );
}

/** The look of a rendered answer, shared by both apps' message bubbles. */
export const MARKDOWN_CLASSES =
  "[&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs dark:[&_code]:bg-white/10 " +
  "[&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_p]:my-1.5 [&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-black/5 [&_pre]:p-2 " +
  "dark:[&_pre]:bg-white/10 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_table]:my-1.5 [&_table]:block [&_table]:overflow-x-auto [&_table]:border-collapse " +
  "[&_td]:border [&_td]:border-stone-300 [&_td]:px-2 [&_td]:py-0.5 dark:[&_td]:border-stone-600 " +
  "[&_th]:border [&_th]:border-stone-300 [&_th]:px-2 [&_th]:py-0.5 [&_th]:text-left [&_th]:font-semibold " +
  "dark:[&_th]:border-stone-600 [&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-2 " +
  "[&_hr]:my-2 [&_del]:opacity-70 [&_input]:mr-1";

/**
 * A document rather than a chat answer (the Workspaces editor's Preview): the same elements
 * as MARKDOWN_CLASSES, with a heading scale and room above and below headings, tables,
 * pictures and code, so a long page reads as a page. Used in place of MARKDOWN_CLASSES.
 */
export const DOCUMENT_CLASSES =
  "text-[15px] leading-7 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "[&_h1]:mt-10 [&_h1]:mb-4 [&_h1]:border-b [&_h1]:border-stone-200 [&_h1]:pb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:leading-tight dark:[&_h1]:border-stone-700 " +
  "[&_h2]:mt-9 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-stone-200 [&_h2]:pb-1.5 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:leading-snug dark:[&_h2]:border-stone-700 " +
  "[&_h3]:mt-7 [&_h3]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:leading-snug " +
  "[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-base [&_h4]:font-semibold " +
  "[&_h5]:mt-5 [&_h5]:mb-1.5 [&_h5]:text-sm [&_h5]:font-semibold [&_h6]:mt-5 [&_h6]:mb-1.5 [&_h6]:text-sm [&_h6]:font-semibold [&_h6]:text-stone-500 " +
  "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_li>ul]:my-1 [&_li>ol]:my-1 " +
  "[&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] dark:[&_code]:bg-white/10 " +
  "[&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/5 [&_pre]:px-4 [&_pre]:py-3 [&_pre]:text-[13px] [&_pre]:leading-6 dark:[&_pre]:bg-white/10 " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_table]:my-6 [&_table]:block [&_table]:overflow-x-auto [&_table]:border-collapse " +
  "[&_th]:border [&_th]:border-stone-300 [&_th]:bg-black/[0.03] [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold dark:[&_th]:border-stone-600 dark:[&_th]:bg-white/5 " +
  "[&_td]:border [&_td]:border-stone-300 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top dark:[&_td]:border-stone-600 " +
  "[&_img]:my-6 [&_img]:max-w-full [&_img]:rounded-lg " +
  "[&_blockquote]:my-5 [&_blockquote]:border-l-4 [&_blockquote]:border-stone-300 [&_blockquote]:pl-4 [&_blockquote]:text-stone-600 dark:[&_blockquote]:border-stone-600 dark:[&_blockquote]:text-stone-300 " +
  "[&_hr]:my-8 [&_hr]:border-stone-200 dark:[&_hr]:border-stone-700 [&_del]:opacity-70 [&_input]:mr-1";
