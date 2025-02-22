import { CheerioCrawler, Dataset, ProxyConfiguration, log, LogLevel, LoadedRequest } from 'crawlee';
import type { CheerioCrawlingContext } from 'crawlee';

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

    // 1. Fixed proxy configuration
    const proxyConfiguration = new ProxyConfiguration({
        tieredProxyUrls: [
            [null],
            ["http://gmyxzepk-rotate:29r7r2d3xequ@p.webshare.io:80"]
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
        maxConcurrency: 8,
        maxRequestsPerMinute: 60,
        maxRequestRetries: 10,
        requestHandlerTimeoutSecs: 60,
        additionalMimeTypes: ['text/html'],
        preNavigationHooks: [
            async ({ request, session }) => {
                log.debug(`Starting request to ${request.url} (retry ${request.retryCount})`);
                if (request.retryCount > 0) {
                    log.debug(`Retiring session for ${request.url}`);
                    session?.retire();
                }

                request.headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Referer': 'https://www.google.com/',
                };
            }
        ],
        async requestHandler({ $, request, enqueueLinks, log }) {
            log.debug(`Processing ${request.url} (label: ${request.label})`);

            if (request.label === 'DETAIL') {
                log.debug(`Processing detail page: ${request.url}`);
                const addressElement = $("span[itemprop='address']");

                if (addressElement.length === 0) {
                    // log.warning(`No address element found, page HTML: ${$.html()}`);
                }

                const address = addressElement.text().trim();
                log.debug(`Extracted address: ${address}`);

                await Dataset.pushData({
                    ...request.userData.schoolInfo,
                    address: address || 'Address not found',
                    divisionCode: request.userData.divisionCode
                });
                return;
            }

           //  log.debug(`List page HTML:\n${$.html()}`);

           const rows = $('table thead th:contains("School")')
           .closest('table')
           .find('tbody tr');            
            log.debug(`Found ${rows.length} rows in table`);

            const schoolLinks = rows.map((i, row) => {
                const $row = $(row);
                const nameLink = $row.find('td:first-child a');

                if (nameLink.length === 0) {
                    log.error(`No school link found in row ${i} HTML:\n${$row.html()}`);
                    return null;
                }

                const relativeLink = nameLink.attr('href');
                if (!relativeLink) {
                    log.error(`Missing href in row ${i} HTML:\n${$row.html()}`);
                    return null;
                }

                const absoluteLink = new URL(relativeLink, request.loadedUrl).toString();
                log.debug(`Processed school link: ${absoluteLink}`);

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

            log.debug(`Found ${schoolLinks.length} valid school links`);

            const paginationLinks = $('div.pagination a.page-numbers:not(.current):not(.next)').first()
            log.debug(`Found ${paginationLinks.length} pagination links`);

            const totalPages = paginationLinks.length > 0
                ? Math.max(...paginationLinks.map((_, el) => {
                    const text = $(el).text().trim();
                    const num = Number(text);
                    log.debug(`Pagination link text: "${text}" → ${num}`);
                    return num;
                }).get())
                : 1;

            log.debug(`Calculated total pages: ${totalPages}`);

            if (schoolLinks.length > 0) {
                log.debug(`Enqueueing ${schoolLinks.length} detail pages`);
                await enqueueLinks({
                    urls: schoolLinks.map(link => link.url),
                    label: 'DETAIL',
                    transformRequestFunction: (req) => {
                        const match = schoolLinks.find(sl => sl.url === req.url);
                        if (!match) {
                            log.error(`No matching school info for ${req.url}`);
                        } else {
                            log.debug(`Matched school info for ${req.url}`);
                        }
                        req.userData = match?.userData || {};
                        return req;
                    }
                });
            } else {
                log.error('No school links found to enqueue');
            }

            const currentPage = request.userData.page;
            log.debug(`Current page: ${currentPage}, Total pages: ${totalPages}`);

            if (currentPage < totalPages) {
                const nextPage = currentPage + 1;
                const nextUrl = new URL(request.url);

                nextUrl.pathname = nextUrl.pathname
                    .replace(/\/page\/\d+$/, '')
                    .replace(/\/$/, '') + `/page/${nextPage}`;

                log.debug(`Next page URL: ${nextUrl.toString()}`);

                await enqueueLinks({
                    urls: [nextUrl.toString()],
                    label: 'LIST',
                    userData: {
                        divisionCode: request.userData.divisionCode,
                        page: nextPage
                    }
                });
            } else {
                log.debug('Reached last page of results');
            }
        },
        failedRequestHandler(context: CheerioCrawlingContext<any, any>) {
            const { request } = context;
            const error = (context as any).error;
            log.error(`Request ${request.url} failed`, error);
        }
        
    });

    const startUrl = `https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`;
    log.debug(`Starting crawl with initial URL: ${startUrl}`);

    await crawler.run([{
        url: startUrl,
        label: 'LIST',
        userData: { divisionCode, page: 1 }
    }]);

    const data = await Dataset.getData<SchoolData>();
    log.debug(`Scraping completed. Retrieved ${data.items.length} items`);
    console.log('Sample items:', data.items.slice(0, 3));

    return data;
}