import { readPublishedContent } from "../lib/content";

export default async function HomePage() {
  const item = await readPublishedContent("home", "en");

  return (
    <main>
      <h1>Forge Web</h1>
      <p>Contract-only content read path.</p>
      <pre>{JSON.stringify(item, null, 2)}</pre>
    </main>
  );
}
