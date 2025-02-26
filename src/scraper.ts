import { CheerioCrawler, CheerioCrawlingContext, Dataset, KeyValueStore, ProxyConfiguration, RequestQueue } from 'crawlee';
import { sha, fetch } from 'bun';

interface SchoolData {
    name: string;
    division: string;
    gradeSpan: string;
    address: string;
    divisionCode: number;
}

interface CachedData {
    hash: string;
    timestamp: number;
    data: SchoolData[];
}

interface Job {
    writer: WritableStreamDefaultWriter;
    dataset: Dataset;
    queue: RequestQueue;
}

const PAGINATION_SELECTOR = 'div.pagination a.page-numbers:not(.current):not(.next)';
const SCHOOL_TABLE_SELECTOR = 'table:has(thead th:contains("School"))';
const proxyConfiguration = new ProxyConfiguration({
    tieredProxyUrls: [
        [null],
        ['http://gmyxzepk-rotate:29r7r2d3xequ@p.webshare.io:80']
    ]
});



const activeJobs = new Map<number, Job>();

export class StreamScraper {
    private crawler = new CheerioCrawler({
        useSessionPool: true,
        sessionPoolOptions: {
            sessionOptions: { maxUsageCount: 3 }
        },
        keepAlive: true,
        proxyConfiguration,
        maxConcurrency: 8,
        maxRequestsPerMinute: 150,
        postNavigationHooks:[this.closeConnections],
        preNavigationHooks:[this.cleanCookies],
        requestHandler: async (context) => {
            const { divisionCode } = context.request.userData;
            const job = activeJobs.get(divisionCode);

            if (!job) {
                context.log.warning(`Orphaned request for division ${divisionCode}`);
                return;
            }

            try {
                await this.handleRequest(context, job);
            } catch (error) {
                context.log.error(`Request failed: ${context.request.url}`, error as any);
                await job.writer.abort(error);
            }
        }
    });

    public async scrape(divisionCode: number, writer: WritableStreamDefaultWriter, forceRefresh = false) {
        const [dataset, queue] = await Promise.all([
            Dataset.open(`schools-${divisionCode}`),
            RequestQueue.open(`queue-${divisionCode}`)
        ]);

        activeJobs.set(divisionCode, {
            writer,
            dataset,
            queue
        });

        this.crawler.requestQueue = queue;
        try {
            const cacheKey = `schools-${divisionCode}`;
            const [cached, currentHash] = await Promise.all([
                KeyValueStore.getValue<CachedData>(cacheKey),
                this.getContentHash(divisionCode)
            ]);

            if (!forceRefresh && cached?.hash === currentHash) {
                await this.writeResult(writer, cached.data);
                return;
            }

            await queue.addRequest({
                url: `https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`,
                label: 'LIST',
                userData: { divisionCode, page: 1 }
            })

            await this.crawler.run();

            const data = (await dataset.getData()).items;

            await this.writeResult(writer, data);
            await KeyValueStore.setValue(cacheKey, JSON.stringify({
                hash: currentHash,
                timestamp: Date.now(),
                data
            }));
        } finally {
            await this.cleanup(divisionCode);
            this.crawler.requestQueue = undefined;
        }
    }


    private async handleRequest(context: CheerioCrawlingContext, job: Job) {
        const { $, request, enqueueLinks } = context;
        const { divisionCode, page = 1 } = request.userData;

        if (request.label === 'DETAIL') {
            const address = $("span[itemprop='address']").text().trim() || 'Address not found';
            await job.dataset.pushData({
                ...request.userData.schoolInfo,
                address,
                divisionCode
            });
            return;
        }

        const schoolLinks = $(SCHOOL_TABLE_SELECTOR + ' tbody tr')
            .map((_, row) => {
                const $row = $(row);
                const link = $row.find('td:first-child a').attr('href');
                return this.createSchoolLink(context, link, divisionCode);
            }).get().filter(Boolean);

        if (schoolLinks.length) {
            await enqueueLinks({
                urls: schoolLinks.map(link => link.url),
                label: 'DETAIL',
                transformRequestFunction: req => ({
                    ...req,
                    userData: schoolLinks.find(sl => sl.url === req.url)?.userData || {},
                    label: 'DETAIL'
                })
            });
        }

        const totalPages = Number($(PAGINATION_SELECTOR).last().text().trim()) || 1;
        if (page < totalPages) {
            const nextUrl = new URL(request.url);
            nextUrl.pathname = nextUrl.pathname.replace(/\/page\/\d+$/, '') + `/page/${page + 1}`;
            await job.queue.addRequest({
                url: nextUrl.toString(),
                label: 'LIST',
                userData: { divisionCode, page: page + 1 }
            });
        }
    }

    // Helper methods
    private createSchoolLink(context: CheerioCrawlingContext, link: string | undefined, divisionCode: number) {
        if (!link) return null;

        return {
            url: new URL(link, context.request.loadedUrl).toString(),
            userData: {
                schoolInfo: {
                    name: context.$('td:eq(0)').text().trim(),
                    division: context.$('td:eq(1)').text().trim(),
                    gradeSpan: context.$('td:eq(2)').text().trim()
                },
                divisionCode
            }
        };
    }

    private async getContentHash(divisionCode: number) {
        const response = await fetch(`https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`, { method: 'HEAD' });
        return sha([
            response.headers.get('ETag'),
            response.headers.get('Last-Modified'),
            response.headers.get('Content-Length')
        ].join(","), 'hex');
    }

    private async writeResult(writer: WritableStreamDefaultWriter, data: any) {
        const encoder = new TextEncoder();
        await writer.write(encoder.encode(JSON.stringify(data)));
    }

    private async cleanCookies({ request }: CheerioCrawlingContext) {
        request.headers!.cookie = '';
    }

    private async closeConnections({ response }: CheerioCrawlingContext) {
        response.destroy();
    }


    private async cleanup(divisionCode: number) {
        const job = activeJobs.get(divisionCode);
        if (!job) return;

        await Promise.all([
            job.dataset.drop(),
            job.queue.drop(),
            job.writer.close()
        ]);

        activeJobs.delete(divisionCode);
    }

}
