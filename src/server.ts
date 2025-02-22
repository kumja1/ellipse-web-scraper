import { scrapeSchools } from './scraper.js';

function applyCorsHeaders(response: Response): Response {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    return new Response(response.body, {
        status: response.status,
        headers
    });
}

async function handleRequest(req: Request) {
    if (req.method === 'OPTIONS') {
        applyCorsHeaders(new Response(null, { status: 204 }));
    }

    let response: Response | null = null;
    const url = new URL(req.url)
    if (req.method === 'POST' && url.pathname === "/scrape") {
        try {
            const formData = await req.formData()
            const divisionCode = Number(formData.get("divisionCode")?.toString());
            const results = await scrapeSchools(divisionCode);
            response = Response.json({
                divisionCode,
                schools: results.items,

            });
        } catch (error: any) {
            response = new Response(error.message, { status: 500 })
        }

    }
    return applyCorsHeaders(response ?? new Response('Not Found', { status: 404 }));
}

Bun.serve({
    fetch: handleRequest,
    port: process.env.PORT || 3000,
});

console.log(`Server running on port ${process.env.PORT || 3000}`);
