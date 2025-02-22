import { scrapeSchools } from './scraper.js';


const CORS_HEADERS = {
    headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'OPTIONS, POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
};

async function handleRequest(req: Request) {

    if (req.method === 'OPTIONS') {
        const res = new Response('Departed', CORS_HEADERS);
        return res;
    }
    
    var url = new URL(req.url)
    if (req.method === 'POST' &&  url.pathname === "/scrape") {
        try {
            const formData = await req.formData()
            const divisionCode = Number(formData.get("divisionCode")?.toString());
            const results = await scrapeSchools(divisionCode);
            return Response.json({
                divisionCode,
                schools: results.items,

            }, CORS_HEADERS);
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
