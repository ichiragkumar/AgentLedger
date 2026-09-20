import { POSTS, getPost } from "@/lib/blog";
import { pageMetadata } from "@/lib/metadata";

export async function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  return pageMetadata({
    title: post ? post.title : "Post not found",
    description: post?.excerpt,
    path: `/blog/${slug}`,
  });
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = getPost(slug);

  if (!post) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold">Post not found</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          <a href="/blog" className="underline">Back to blog</a>.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <a href="/blog" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        ← Blog
      </a>
      <p className="mt-4 text-xs text-zinc-500">
        {post.date} · {post.readingMinutes} min read
      </p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight text-balance">{post.title}</h1>
      <article className="mt-6 space-y-4">
        {post.paragraphs.map((p, i) => (
          <p key={i} className="leading-7 text-zinc-700 dark:text-zinc-300">{p}</p>
        ))}
      </article>
    </main>
  );
}
