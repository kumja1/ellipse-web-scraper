import { scrapeSchools } from './scraper.js';

async function handleRequest(req: Request) {
    if (req.method === 'POST' && req.url.endsWith("/scrape")) {
        try {
            const formData = await req.formData()
            const divisionCode = Number(formData.get("divisionCode")?.toString());
            const results = await scrapeSchools(divisionCode);
            return Response.json({
                divisionCode,
                schools: results,
            });
        } catch (error: any) {
            return new Response(error.message, { status: 500 })
        }

    }
    return new Response('Not Found', { status: 404 });
}

Bun.serve({
    fetch: handleRequest,
    port: process.env.PORT || 3000,
});

console.log(`Server running on port ${process.env.PORT || 3000}`);
