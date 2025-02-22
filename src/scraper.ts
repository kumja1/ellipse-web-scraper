import { CheerioCrawler, Dataset, ProxyConfiguration, log, LogLevel } from 'crawlee';

interface SchoolData {
    name: string;
    division: string;
    gradeSpan: string;
    address: string;
    divisionCode: number;
}

export async function scrapeSchools(divisionCode: number) {
    log.setLevel(LogLevel.DEBUG);
    log.debug(`Starting scrapeSchools with divisionCode: ${divisionCode}`);

    const proxyConfiguration = new ProxyConfiguration({
        proxyUrls: [
            "http://gmyxzepk-rotate:29r7r2d3xequ@p.webshare.io:80"
        ]
    });

    const crawler = new CheerioCrawler({
        useSessionPool: true,
        proxyConfiguration,
        sessionPoolOptions: {
            sessionOptions: {
                maxUsageCount: 3,
            },
        },
        retryOnBlocked: true,
        minConcurrency: 8,
        maxRequestsPerMinute: 60,
        maxRequestRetries: 10,
        requestHandlerTimeoutSecs: 60,
        additionalMimeTypes: ['text/html'],
        preNavigationHooks: [
            async ({ request, session }) => {
                if (request.retryCount > 0) session?.retire();

                request.headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Referer': 'https://www.google.com/',
                };
            }
        ],
        async requestHandler({ $, request, enqueueLinks }) {
            if (request.label === 'DETAIL') {
                const address = $("span[itemprop='address']").text().trim();
                await Dataset.pushData({
                    ...request.userData.schoolInfo,
                    address: address || 'Address not found',
                    divisionCode: request.userData.divisionCode
                });
                return;
            }

            const rows = $('table tbody tr');
            const schoolLinks = rows.map((_, row) => {
                const $row = $(row);
                const nameLink = $row.find('td:first-child a');
                // 3. Convert to absolute URL
                const relativeLink = nameLink.attr('href');
                if (!relativeLink) return null;
                const absoluteLink = new URL(relativeLink, request.loadedUrl).toString();

                return {
                    url: absoluteLink,
                    userData: {
                        schoolInfo: {
                            name: nameLink.text().trim(),
                            division: $row.find('td:nth-child(2)').text().trim(),
                            gradeSpan: $row.find('td:nth-child(3)').text().trim()
                        }
                    }
                };
            }).get().filter(Boolean);

            // 4. Improved pagination handling
            const paginationLinks = $('div.pagination a.page-numbers:not(.current)');
            const totalPages = paginationLinks.length > 0
                ? Math.max(...paginationLinks.map((_, el) =>
                    Number($(el).text().trim())))
                : 1;

            await enqueueLinks({
                urls: schoolLinks.map(link => link.url),
                label: 'DETAIL',
                transformRequestFunction: (req) => {
                    const match = schoolLinks.find(sl => sl.url === req.url);
                    if (match) req.userData = {
                        divisionCode: request.userData.divisionCode,
                        schoolInfo: match.userData.schoolInfo
                    };
                    return req;
                }
            });

            const currentPage = request.userData.page;
            if (currentPage < totalPages) {
                const nextPage = currentPage + 1;
                const nextUrl = new URL(request.url);

                nextUrl.pathname = nextUrl.pathname
                    .replace(/\/page\/\d+$/, '')
                    .replace(/\/$/, '') + `/page/${nextPage}`;

                await enqueueLinks({
                    urls: [nextUrl.toString()],
                    label: 'LIST',
                    userData: {
                        divisionCode: request.userData.divisionCode,
                        page: nextPage
                    }
                });
            }
        }
    });

    await crawler.run([{
        url: `https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`,
        label: 'LIST',
        userData: { divisionCode, page: 1 }
    }]);

    return Dataset.getData<SchoolData>();
}