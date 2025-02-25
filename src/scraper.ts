import { CheerioCrawler, Dataset, ProxyConfiguration, log, LogLevel, KeyValueStore, CheerioCrawlingContext } from 'crawlee';
import { CheerioAPI, load } from 'cheerio';
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
    keepAlive: true,
    proxyConfiguration,
    sessionPoolOptions: {
        sessionOptions: { maxUsageCount: 5 },
        persistStateKeyValueStoreId: undefined,
    },
    retryOnBlocked: true,
    maxConcurrency: 15,
    maxRequestsPerMinute: 300,
    autoscaledPoolOptions: {
        desiredConcurrency: 10,
        maxConcurrency: 25,
        scaleUpStepRatio: 0.8,
        systemStatusOptions: { maxMemoryOverloadedRatio: 0.85 }
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

    const CACHE_KEY = `schools-${divisionCode}`;
    const cachedData = await KeyValueStore.getValue<CachedData>(CACHE_KEY);
    const { hash: currentHash } = await fetchPageContent(divisionCode);
    if (!forceRefresh && cachedData) {
        log.info('Using valid cached data');
        if (cachedData.hash === currentHash) {
            log.info('Content unchanged, updating timestamp');
            await KeyValueStore.setValue(CACHE_KEY, { ...cachedData, timestamp: Date.now() });
            return cachedData.data;
        }
    }

    const dataset = await Dataset.open<SchoolData>(`schools-${divisionCode}`);
    datasetMap.set(divisionCode, dataset);

    try {
        crawler.addRequests([{
            url: `https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`,
            label: 'LIST',
            userData: { divisionCode, page: 1 }
        }])
        
        if (!crawler.running)  await crawler.run();
        const data = (await dataset.getData()).items;
        await KeyValueStore.setValue(CACHE_KEY, {
            hash: currentHash,
            timestamp: Date.now(),
            data
        });

        await writer.write(data);
        log.info(`Crawling completed. Found ${data.length} schools`)
    }
    finally {
        await dataset.drop();
        await writer.close()

        datasetMap.delete(divisionCode)
    }
}

async function fetchPageContent(divisionCode: number) {
    const response = await fetch(`https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`);
    return { hash: hashSite(load(await response.text())) };
}

const hashSite = ($: CheerioAPI): string => {
    try {
        return sha(
            ($(SCHOOL_TABLE_SELECTOR).html() ?? '') +
            ($(PAGINATION_SELECTOR).html() ?? '')
                .replace(/\s+/g, ' ')
                .replace(/<!--.*?-->/gs, '')
                .replace(/\s*</g, '<')
                .replace(/>\s*/g, '>')
                .replace(/"\s+/g, '"')
                .replace(/\s+"/g, '"')
                .toLowerCase(),
            'hex'
        );
    } catch (error) {
        log.warning('Hash generation failed', error as any);
        return 'invalid';
    }
};

export function getRandomHeader() {
    const deviceType = Math.random() < 0.9 ? 'desktop' : 'mobile';
    return {
        'User-Agent': userAgents[deviceType][Math.floor(Math.random() * userAgents[deviceType].length)],
        'Referer': referers[Math.floor(Math.random() * referers.length)],
        'Accept-Language': languages[Math.floor(Math.random() * languages.length)]
    };
}
