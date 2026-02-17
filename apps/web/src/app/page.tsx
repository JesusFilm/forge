import { readPublishedContent } from "../lib/content";

export default async function HomePage() {
  const item = await readPublishedContent("home", "en");

  return (
    <main className="p-4 text-lg">
      <h1 className="text-2xl font-bold">Forge Web</h1>
      <p>Contract-only content read path.</p>
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </main>
  );
}
