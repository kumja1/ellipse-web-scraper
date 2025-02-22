import { CheerioCrawler, Dataset, ProxyConfiguration, log, LogLevel, KeyValueStore, type CheerioCrawlingContext } from 'crawlee';
import { CheerioAPI, load } from "cheerio"
import { languages, referers, userAgents } from "./lists.js";
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
let activeCrawler: CheerioCrawler | null = null;

export async function scrapeSchools(divisionCode: number, forceRefresh = false) {
    log.setLevel(LogLevel.INFO);
    const CACHE_KEY = `schools-${divisionCode}`;
    const cachedData = await KeyValueStore.getValue<CachedData>(CACHE_KEY);
    if (!forceRefresh && cachedData?.hash) {
        log.info('Using valid cached data');
        return cachedData.data;
    }
    const TIME_STAMP = Date.now();
    const { hash: currentHash } = await fetchPageContent(divisionCode);
    if (cachedData?.hash === currentHash) {
        log.info('Content unchanged, updating timestamp');
        await KeyValueStore.setValue(CACHE_KEY, {
            ...cachedData,
            timestamp: TIME_STAMP
        });
        return cachedData.data;
    }

    if (!activeCrawler) {
        activeCrawler = createCrawler();
        process.on('SIGINT', async () => {
            await activeCrawler?.teardown();
            activeCrawler = null;
        });
    }

    const tempDatasetName = `temp-${CACHE_KEY}-${Date.now()}`;
    const dataset = await Dataset.open(tempDatasetName);
    try {
        await activeCrawler.run([{
            url: `https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`,
            label: 'LIST',
            userData: { divisionCode, page: 1, tempDatasetName }
        }]);

        const data = (await dataset.getData()).items as unknown as SchoolData[]

        await KeyValueStore.setValue(CACHE_KEY, {
            hash: currentHash,
            timestamp: Date.now(),
            data
        });

        return data;
    } catch (error) {
        log.error(`Scraper failed:`, error as any)
    } finally {
        if (dataset) {
            try {
                await dataset.drop();
            } catch (error) {
                log.warning('Failed to drop dataset', error as any);
            }
        }
    }
}

async function fetchPageContent(divisionCode: number) {
    const response = await fetch(`https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`);
    return {
        hash: hashSite(load(await response.text()))
    };
}

function createCrawler() {
    return new CheerioCrawler({
        useSessionPool: true,
        proxyConfiguration: new ProxyConfiguration({
            tieredProxyUrls: [
                [null],
                ["http://gmyxzepk-rotate:29r7r2d3xequ@p.webshare.io:80"]
            ]
        }),
        sessionPoolOptions: {
            sessionOptions: { maxUsageCount: 10 },
            persistStateKeyValueStoreId: 'session-pool',
        },
        retryOnBlocked: true,
        maxConcurrency: 25,
        maxRequestsPerMinute: 450,
        autoscaledPoolOptions: {
            desiredConcurrency: 10,
            maxConcurrency: 30,
            scaleUpStepRatio: 0.5,
            systemStatusOptions: { maxMemoryOverloadedRatio: 0.8 }
        },
        preNavigationHooks: [async ({ request, session }) => {
            request.headers = getRandomHeader();
            if (request.retryCount > 0) {
                log.warning(`Retiring session for ${request.url}`);
                session?.retire();
            }
            await sleep(Math.random() * 1000);
        }],
        async requestHandler({ $, request, enqueueLinks }) {
            try {
                const { tempDatasetName, divisionCode, page } = request.userData;
                const dataset = await Dataset.open(tempDatasetName);
                if (request.label === 'DETAIL') {
                    const address = $("span[itemprop='address']").text().trim() || 'Address not found';
                    await dataset.pushData({
                        ...request.userData.schoolInfo,
                        address,
                        divisionCode
                    });
                    return;
                }

                // Process list page
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
                                }
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

                // Pagination
                const totalPages = Number($(PAGINATION_SELECTOR).last().text().trim()) || 1;

                if (page < totalPages) {
                    const nextUrl = new URL(request.url);
                    nextUrl.pathname = nextUrl.pathname.replace(/\/page\/\d+$/, '') + `/page/${page + 1}`;
                    await enqueueLinks({
                        urls: [nextUrl.toString()],
                        label: 'LIST',
                        userData: {
                            divisionCode: request.userData.divisionCode,
                            page: page + 1
                        }
                    });
                }
            } finally {
                $.root().remove();
            }
        },
        failedRequestHandler({ request, error }) {
            log.error(`Request failed: ${request.url}`, error as any);
        }
    });
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