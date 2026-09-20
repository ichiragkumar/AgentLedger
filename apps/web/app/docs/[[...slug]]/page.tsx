/**
 * Docs route — `app/docs/[[...slug]]` (owner: ledger-web-journey).
 *
 * MDX-ready stub: content lives as Markdown under `content/docs/`.
 * The tiny renderer below handles headings / code / lists / links so the
 * route ships today; swap `renderMarkdown` for compiled MDX when the MDX
 * pipeline lands (no route changes needed).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pageMetadata } from "@/lib/metadata";

const DOCS_DIR = path.join(process.cwd(), "content", "docs");

interface DocEntry {
  slug: string[];
  title: string;
}

const DOCS: DocEntry[] = [
  { slug: ["getting-started"], title: "Getting Started" },
];

export async function generateStaticParams() {
  // Root /docs serves the index; [[...slug]] entries serve each doc.
  return [{ slug: undefined as unknown as string[] }, ...DOCS.map((d) => ({ slug: d.slug }))];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const doc = DOCS.find((d) => d.slug.join("/") === (slug ?? []).join("/"));
  const title = doc ? doc.title : "Docs";
  return pageMetadata({
    title,
    description: `AgentLedger documentation — ${title}.`,
    path: `/docs${slug?.length ? `/${slug.join("/")}` : ""}`,
  });
}

async function loadDoc(slug: string[]): Promise<string | null> {
  try {
    return await fs.readFile(path.join(DOCS_DIR, ...slug) + ".md", "utf8");
  } catch {
    return null;
  }
}

/** Minimal Markdown renderer (headings, code fences, lists, links, inline code). */
function renderMarkdown(md: string): React.ReactNode[] {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const inline = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    const re = /(`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) parts.push(text.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith("`")) {
        parts.push(
          <code key={k++} className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-zinc-800">
            {tok.slice(1, -1)}
          </code>,
        );
      } else {
        const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
        if (lm) {
          parts.push(
            <a key={k++} href={lm[2]} className="underline underline-offset-2">
              {lm[1]}
            </a>,
          );
        } else {
          parts.push(tok);
        }
      }
      last = m.index + tok.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} className="overflow-x-auto rounded-lg bg-zinc-950 p-4 text-sm text-zinc-100 dark:bg-zinc-900">
          <code>{buf.join("\n")}</code>
        </pre>,
      );
    } else if (line.startsWith("# ")) {
      out.push(<h1 key={key++} className="text-3xl font-bold tracking-tight">{inline(line.slice(2))}</h1>);
      i++;
    } else if (line.startsWith("## ")) {
      out.push(<h2 key={key++} className="mt-8 text-2xl font-semibold tracking-tight">{inline(line.slice(3))}</h2>);
      i++;
    } else if (line.startsWith("### ")) {
      out.push(<h3 key={key++} className="mt-6 text-xl font-semibold">{inline(line.slice(4))}</h3>);
      i++;
    } else if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*-\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*-\s+/, ""));
      out.push(
        <ul key={key++} className="list-disc space-y-1 pl-6">
          {items.map((it, j) => <li key={j}>{inline(it)}</li>)}
        </ul>,
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !/^\s*-\s+/.test(lines[i])) {
        buf.push(lines[i++]);
      }
      out.push(<p key={key++} className="leading-7 text-zinc-700 dark:text-zinc-300">{inline(buf.join(" "))}</p>);
    }
  }
  return out;
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;

  if (!slug || slug.length === 0) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <a href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← AgentLedger
        </a>
        <h1 className="mt-4 text-3xl font-bold tracking-tight">Docs</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          One proxy. Five stages. Start here.
        </p>
        <ul className="mt-6 space-y-3">
          {DOCS.map((d) => (
            <li key={d.slug.join("/")} className="rounded-xl border border-zinc-200 p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
              <a href={`/docs/${d.slug.join("/")}`} className="font-medium underline-offset-2 hover:underline">
                {d.title}
              </a>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const md = await loadDoc(slug);
  if (md === null) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">Not found</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          No doc at <code>/docs/{slug.join("/")}</code> yet.{" "}
          <a href="/docs" className="underline">Back to docs</a>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <a href="/docs" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Docs
      </a>
      <article className="mt-4 space-y-4">{renderMarkdown(md)}</article>
    </main>
  );
}
