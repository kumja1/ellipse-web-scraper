import { CheerioCrawler, Dataset, ProxyConfiguration, log, LogLevel, KeyValueStore, CheerioCrawlingContext } from 'crawlee';
import { languages, referers, userAgents } from './lists.js';
import { sha, sleep, fetch } from 'bun';

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

const PAGINATION_SELECTOR = 'div.pagination a.page-numbers:not(.current):not(.next)';
const SCHOOL_TABLE_SELECTOR = 'table:has(thead th:contains("School"))';
const proxyConfiguration = new ProxyConfiguration({
    tieredProxyUrls: [
        [null],
        ['http://gmyxzepk-rotate:29r7r2d3xequ@p.webshare.io:80']
    ]
});

const datasetMap = new Map<number, Dataset>();


const crawler = new CheerioCrawler({
    useSessionPool: true,
    proxyConfiguration,
    sessionPoolOptions: {
        sessionOptions: { maxUsageCount: 5 },
        persistStateKeyValueStoreId: undefined,
    },
    retryOnBlocked: true,
    maxConcurrency: 15,
    maxRequestsPerMinute: 200,
    autoscaledPoolOptions: {
        desiredConcurrency: 10,
        maxConcurrency: 25,
        scaleUpStepRatio: 0.8,
        systemStatusOptions: { maxMemoryOverloadedRatio: 0.95 }
    },
    preNavigationHooks: [
        async ({ request, session }) => {
            request.headers = getRandomHeader();
            if (request.retryCount > 0) {
                log.warning(`Retiring session for ${request.url}`);
                session?.retire();
            }
            await sleep(50);
        }
    ],
    requestHandler: async ({ $, request, enqueueLinks }: CheerioCrawlingContext) => {
        const { divisionCode: code, page = 1 } = request.userData;
        const dataset = datasetMap.get(code);
        if (!dataset) throw new Error(`No dataset found for division ${code}`);

        if (request.label === 'DETAIL') {
            const address = $("span[itemprop='address']").text().trim() || 'Address not found';
            await dataset.pushData({
                ...request.userData.schoolInfo,
                address,
                divisionCode: code
            });
            return;
        }

        const schoolLinks = $(SCHOOL_TABLE_SELECTOR + ' tbody tr')
            .map((_, row) => {
                const $row = $(row);
                const link = $row.find('td:first-child a').attr('href');
                return link ? {
                    url: new URL(link, request.loadedUrl).toString(),
                    userData: {
                        schoolInfo: {
                            name: $row.find('td:eq(0)').text().trim(),
                            division: $row.find('td:eq(1)').text().trim(),
                            gradeSpan: $row.find('td:eq(2)').text().trim()
                        },
                        divisionCode: code
                    }
                } : null;
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
            await enqueueLinks({
                urls: [nextUrl.toString()],
                label: 'LIST',
                userData: { divisionCode: code, page: page + 1 }
            });
        }
        $.root().remove();
    },
    failedRequestHandler({ request, error }) {
        log.error(`Request failed after retries: ${request.url}`, { error });
    }
});

export async function scrapeSchools(divisionCode: number, writer: WritableStreamDefaultWriter, forceRefresh = false) {
    log.setLevel(LogLevel.INFO);

    let isStreamClosed = false;
    writer.closed.then(_ => isStreamClosed = true)

    const CACHE_KEY = `schools-${divisionCode}`;
    const targetUrl = `https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`
    const cachedData: CachedData = JSON.parse(await KeyValueStore.getValue<string>(CACHE_KEY));
    const currentHash = await getPageHash(targetUrl);

    if (!forceRefresh && cachedData) {
        log.info('Using valid cached data');
        if (cachedData.hash === currentHash) {
            log.info('Content unchanged, updating timestamp');
            await KeyValueStore.setValue(CACHE_KEY, JSON.stringify({ ...cachedData, timestamp: Date.now() }));
            writeToStream(writer, JSON.stringify(cachedData.data), isStreamClosed)
        }
    }

    const dataset = await Dataset.open<SchoolData>(`schools-${divisionCode}`);
    datasetMap.set(divisionCode, dataset);

    try {
        await crawler.run([{
            url: targetUrl,
            label: 'LIST',
            userData: { divisionCode, page: 1 }
        }]);

        const datasetItems = (await dataset.getData()).items
        await KeyValueStore.setValue(CACHE_KEY, JSON.stringify({
            hash: currentHash,
            timestamp: Date.now(),
            data: datasetItems
        }));

        writeToStream(writer, JSON.stringify(datasetItems), isStreamClosed)
        log.info(`Crawling completed. Found ${datasetItems.length} schools`)
    }
    finally {
        await dataset.drop();
        await writer.close()

        datasetMap.delete(divisionCode)
    }
}



const getPageHash = async (url: string) => {
    const response = await fetch(url, { method: 'HEAD' });
    return hash(
        response.headers.get('ETag'),
        response.headers.get('Last-Modified'),
        response.headers.get('Content-Length'))
};

const writeToStream = (writer: WritableStreamDefaultWriter, data: any, isClosed: boolean) => {
    if (!isClosed)
        writer.write(data)
}


const hash = (...params: any[]): string => {
    try {
        return sha(
            params.join("-"),
            'hex'
        );
    } catch (error) {
        log.warning('Hash generation failed', error as any);
        return 'invalid';
    }
};

const getRandomHeader = () => {
    const deviceType = Math.random() < 0.9 ? 'desktop' : 'mobile';
    return {
        'User-Agent': userAgents[deviceType][Math.floor(Math.random() * userAgents[deviceType].length)],
        'Referer': referers[Math.floor(Math.random() * referers.length)],
        'Accept-Language': languages[Math.floor(Math.random() * languages.length)]
    };
}
