import { StreamScraper } from "./scraper.js";

const scraper = new StreamScraper();
Bun.serve({
    fetch: async (req: Request) => {
        const url = new URL(req.url);
        if (req.method === 'POST' && url.pathname === "/scrape") {
            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();

            try {
                const formData = await req.formData();
                const divisionCode = Number(formData.get("divisionCode"));

                scraper.scrape(divisionCode, writer)
                    .catch(error => writer.abort(error));

                return new Response(readable, {
                    headers: { "Content-Type": "application/ndjson" }
                });
            } catch (error) {
                return new Response((<any>error).message, { status: 500 });
            }
        }
        return new Response('Not Found', { status: 404 });
    },
    port: process.env.PORT || 3000
});