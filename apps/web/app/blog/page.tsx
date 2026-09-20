import { POSTS } from "@/lib/blog";
import { pageMetadata } from "@/lib/metadata";

export const generateMetadata = () =>
  pageMetadata({
    title: "Blog",
    description:
      "AgentLedger blog — TokenOps in practice: caching wins, routing results, enforcement stories.",
    path: "/blog",
  });

export default function BlogIndex() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <a href="/" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← AgentLedger
      </a>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Blog</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        TokenOps in practice — from “I can finally see…” to “…knows my workflow better than I do”.
      </p>
      <ul className="mt-8 space-y-6">
        {POSTS.map((post) => (
          <li key={post.slug} className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">
              {post.date} · {post.readingMinutes} min read
            </p>
            <a href={`/blog/${post.slug}`} className="mt-1 block text-xl font-semibold underline-offset-2 hover:underline">
              {post.title}
            </a>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{post.excerpt}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
