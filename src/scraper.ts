import { CheerioCrawler, Dataset, ProxyConfiguration } from 'crawlee';

interface SchoolData {
    name: string;
    division: string;
    gradeSpan: string;
    address: string;
    divisionCode: number;
}

export async function scrapeSchools(divisionCode: number) {
    const proxyConfiguration = new ProxyConfiguration({
        proxyUrls: [
            'http://150.136.247.129:1080',
            'http://173.208.246.194:40000',
            'http://45.180.16.212:9292',
            'http://51.68.175.56:1080',
            'http://89.116.27.24:8888',
            'http://113.160.133.32:8080',
            'http://216.229.112.25:8080',
            'http://138.91.159.185:80',
            'http://23.247.137.142:80'
        ],
    });

    const crawler = new CheerioCrawler({
        proxyConfiguration,
        retryOnBlocked: true,
        maxRequestRetries: 3,
        maxConcurrency: 8,
        maxRequestsPerMinute: 120,
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
                const cells = $(row).find('td');
                return {
                    url: $(cells.eq(0)).find('a').attr('href'),
                    userData: {
                        schoolInfo: {
                            name: cells.eq(0).text().trim(),
                            division: cells.eq(1).text().trim(),
                            gradeSpan: cells.eq(2).text().trim(),
                        }
                    }
                };
            }).get();

            const totalPages = Number(
                $('div.pagination a.page-numbers:not(.current):not(.next)')
                  .last()
                  .text()
                  .replace(/\D/g, '') || '1'  // Remove non-numeric characters
              );            

            await enqueueLinks({
                urls: schoolLinks.map(link => <string>link.url),
                label: 'DETAIL',
                forefront: true,
                userData: {
                    divisionCode: request.userData.divisionCode,
                    schoolInfo: schoolLinks[0]?.userData.schoolInfo
                }
            });

            const currentPage = request.userData.page;
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