import { CheerioCrawler, Dataset, ProxyConfiguration, log, LogLevel } from 'crawlee';

// Define the structure for school data
interface SchoolData {
    name: string;
    division: string;
    gradeSpan: string;
    address: string;
    divisionCode: number;
}

export async function scrapeSchools(divisionCode: number) {
    // Set the logging level to DEBUG for detailed output
    log.setLevel(LogLevel.DEBUG);
    log.debug(`Starting scrapeSchools with divisionCode: ${divisionCode}`);

    const proxyConfiguration = new ProxyConfiguration({
         proxyUrls:[
            'http://gmyxzepk-rotate:29r7r2d3xequ@p.webshare.io:80'
        ],
    });
    log.debug('Proxy configuration initialized.');

    // Initialize the crawler
    const crawler = new CheerioCrawler({
        useSessionPool:true,
        proxyConfiguration,
        retryOnBlocked: true,
        maxRequestRetries: 5,
        maxConcurrency: 8,
        maxRequestsPerMinute: 120,
        async requestHandler({ $, request, enqueueLinks }) {
            log.debug(`Processing ${request.url} with label: ${request.label}`);

            if (request.label === 'DETAIL') {
                const address = $("span[itemprop='address']").text().trim();
                log.debug(`Extracted address: ${address}`);
                await Dataset.pushData({
                    ...request.userData.schoolInfo,
                    address: address || 'Address not found',
                    divisionCode: request.userData.divisionCode
                });
                log.debug('School data saved to dataset.');
                return;
            }

            const rows = $('table tbody tr');
            log.debug(`Found ${rows.length} rows in the table.`);

            const schoolLinks = rows.map((_, row) => {
                const cells = $(row).find('td');
                const link = $(cells.eq(0)).find('a').attr('href');
                const name = cells.eq(0).text().trim();
                const division = cells.eq(1).text().trim();
                const gradeSpan = cells.eq(2).text().trim();
                log.debug(`Extracted school: ${name}, Division: ${division}, Grade Span: ${gradeSpan}, Link: ${link}`);
                return {
                    url: link,
                    userData: {
                        schoolInfo: {
                            name,
                            division,
                            gradeSpan,
                        }
                    }
                };
            }).get();

            const totalPages = Number(
                $('div.pagination a.page-numbers:not(.current):not(.next)')
                    .last()
                    .text()
                    .replace(/\D/g, '') || '1'
            );
            log.debug(`Total pages found: ${totalPages}`);

            await enqueueLinks({
                urls: schoolLinks.map(link => <string>link.url),
                label: 'DETAIL',
                forefront: true,
                userData: {
                    divisionCode: request.userData.divisionCode,
                    schoolInfo: schoolLinks[0]?.userData.schoolInfo
                }
            });
            log.debug('Enqueued detail pages for schools.');

            const currentPage = request.userData.page;
            log.debug(`Current page: ${currentPage}`);
            if (currentPage <= totalPages) {
                const nextPage = currentPage + 1;
                await enqueueLinks({
                    urls: [`${request.url}&page=${nextPage}`],
                    label: 'LIST',
                    userData: {
                        divisionCode: request.userData.divisionCode,
                        page: nextPage
                    }
                });
                log.debug(`Enqueued next page: ${nextPage}`);
            }
        }
    });

    // Start the crawler
    await crawler.run([{
        url: `https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`,
        label: 'LIST',
        userData: { divisionCode, page: 1 }
    }]);
    log.debug('Crawler run completed.');

    // Retrieve and return the scraped data
    const data = await Dataset.getData<SchoolData>();
    log.debug(`Retrieved ${data.items.length} items from the dataset.`);
    return data;
}
