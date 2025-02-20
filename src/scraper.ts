import { CheerioCrawler, Dataset, ProxyConfiguration } from 'crawlee';

export async function scrapeSchools(divisionCode: number) {
    const results: any[] = [];

    const crawler = new CheerioCrawler({
        proxyConfiguration: new ProxyConfiguration({
            proxyUrls: process.env.PROXY_URLS?.split(',') || [],
        }),
        async requestHandler({ $, request }) {
            const schools = $('table tbody tr').map((i, row) => {
                const cells = $(row).find('td');
                return {
                    name: cells.eq(0).text().trim(),
                    division: cells.eq(1).text().trim(),
                    gradeSpan: cells.eq(2).text().trim(),
                    address: cells.eq(3).text().trim()
                };
            }).get();

            const totalPages = Math.max(...$('div.pagination a.page-numbers')
                .map((_, el) => parseInt($(el).text()) || 0)
                .get());

            await Dataset.pushData({
                divisionCode: request.userData.divisionCode,
                schools,
                currentPage: request.userData.page,
                totalPages
            });

            if (request.userData.page < totalPages) {
                await crawler.addRequests([{
                    url: `${request.url}&page=${request.userData.page + 1}`,
                    userData: {
                        divisionCode: request.userData.divisionCode,
                        page: request.userData.page + 1
                    }
                }]);
            }
        }
    });

    await crawler.run([{
        url: `https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`,
        userData: { divisionCode, page: 1 }
    }]);

    return results;
}