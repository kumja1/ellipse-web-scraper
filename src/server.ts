import { scrapeSchools } from './scraper.js';


async function handleRequest(req: Request) {

    let response: Response | null = null;
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === "/scrape") {
        try {
            
            const formData = await req.formData()
            const divisionCode = Number(formData.get("divisionCode")?.toString());
            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();
            
            scrapeSchools(divisionCode, writer)
                .catch(error => {
                    console.error("Scraping error:", error);
                    writer.abort(error);
                });

            response = new Response(readable, {
                headers: { "Content-Type": "application/json" }
            })
        } catch (error: any) {
            response = new Response(error.message, { status: 500 })
        }

    }
    return response ?? new Response('Not Found', { status: 404 });
}

Bun.serve({
    fetch: handleRequest,
    port: process.env.PORT || 3000,
});

console.log(`Server running on port ${process.env.PORT || 3000}`);
