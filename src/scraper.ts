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

export async function scrapeSchools(divisionCode: number) {
    log.setLevel(LogLevel.INFO);
    log.info(`Starting scrapeSchools for division: ${divisionCode}`);
    const CACHE_KEY = `schools-${divisionCode}`;
    const dataset = await Dataset.open<SchoolData>();
    const initialRequest = await fetch(`https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`);
    const initialHtml = await initialRequest.text();
    const currentHash = hashSite(load(initialHtml));

    const cachedData = await KeyValueStore.getValue<CachedData>(CACHE_KEY);
    if (cachedData?.hash === currentHash) {
        log.info('Using valid cached data');
        return cachedData.data;
    }

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
                maxUsageCount: 10,
            },
            persistStateKeyValueStoreId: 'session-pool',
        },
        retryOnBlocked: true,
        maxConcurrency: 25,
        maxRequestsPerMinute: 450,
        autoscaledPoolOptions: {
            desiredConcurrency: 10,
            maxConcurrency: 30,
            scaleUpStepRatio: 0.5,
            systemStatusOptions: {
                maxMemoryOverloadedRatio: 0.8
            }
        },
        preNavigationHooks: [
            async ({ request, session }) => {
                if (request.retryCount > 0) {
                    log.warning(`Retiring session for ${request.url}`);
                    session?.retire();
                }
                await sleep(Math.random() * 1000)
            }
        ],
        async requestHandler({ $, request, enqueueLinks }) {
            try {
                if (request.label === 'DETAIL') {
                    await handleDetailPage($, request, dataset);
                    return;
                }

                await handleListPage($, request, enqueueLinks);
            } finally {
                $.root().remove();
            }
        },
        failedRequestHandler({ request, error }) {
            log.error(`Request ${request.url} failed after ${request.retryCount} retries`, <any>error);
        }
    });

    try {
        await crawler.run([{
            url: `https://schoolquality.virginia.gov/virginia-schools?division=${divisionCode}`,
            label: 'LIST',
            userData: { divisionCode, page: 1 }
        }]);

        const data = (await dataset.getData()).items;
        await KeyValueStore.setValue(CACHE_KEY, {
            hash: currentHash,
            timestamp: Date.now(),
            data
        });

        return data;
    } catch (error: any) {
        log.error('Scraping failed:', error);
        throw error;
    } finally {
        dataset.drop();
    }
}

async function handleDetailPage($: CheerioCrawlingContext['$'], request: any, dataset: Dataset) {
    const address = $("span[itemprop='address']").text().trim();
    await dataset.pushData({
        ...request.userData.schoolInfo,
        address: address || 'Address not found',
        divisionCode: request.userData.divisionCode
    });
}

async function handleListPage($: CheerioCrawlingContext['$'], request: any, enqueueLinks: CheerioCrawlingContext['enqueueLinks']) {
    const schoolLinks = $(SCHOOL_TABLE_SELECTOR + 'tbody tr')
        .map((_, row) => {
            const $row = $(row);
            const link = $row.find('td:eq(0) a').attr('href');

            return link ? {
                url: new URL(link, request.loadedUrl).toString(),
                userData: {
                    schoolInfo: {
                        name: $row.find('td:first-child').text().trim(),
                        division: $row.find('td:nth-child(2)').text().trim(),
                        gradeSpan: $row.find('td:nth-child(3)').text().trim()
                    }
                }
            } : null;
        }).get().filter(Boolean);

    if (schoolLinks.length > 0) {
        await enqueueLinks({
            urls: schoolLinks.map(link => link.url),
            label: 'DETAIL',
            transformRequestFunction: (req) => ({
                ...req,
                userData: schoolLinks.find(sl => sl.url === req.url)?.userData || {},
                label: 'DETAIL'
            })
        });
    }

    const currentPage = request.userData.page;
    const totalPages = getTotalPages($);

    log.debug(`Total Pages: ${totalPages}`);

    if (currentPage < totalPages) {
        const nextUrl = new URL(request.url);
        nextUrl.pathname = nextUrl.pathname.replace(/\/page\/\d+$/, '') + `/page/${currentPage + 1}`;

        await enqueueLinks({
            urls: [nextUrl.toString()],
            label: 'LIST',
            userData: {
                divisionCode: request.userData.divisionCode,
                page: currentPage + 1
            }
        });
    }
}

function getTotalPages($: CheerioCrawlingContext['$']): number {
    try {
        return Number($(PAGINATION_SELECTOR).last().text().trim()) || 1;
    } catch (error) {
        log.warning('Error parsing total pages, defaulting to 1');
        return 1;
    }
}

export function getRandomHeader() {
    const deviceType = Math.random() < 0.9 ? 'desktop' : 'mobile';
    return {
        userAgent: userAgents[deviceType][Math.floor(Math.random() * userAgents[deviceType].length)],
        referer: referers[Math.floor(Math.random() * referers.length)],
        language: languages[Math.floor(Math.random() * languages.length)]
    };
}


const hashSite = ($: CheerioAPI): string => sha(($(SCHOOL_TABLE_SELECTOR).html() + $(PAGINATION_SELECTOR).html()!)
    .replace(/\s+/g, ' ')         // Collapse whitespace
    .replace(/<!--.*?-->/gs, '')   // Remove comments
    .replace(/\s*</g, '<')         // Trim whitespace before tags
    .replace(/>\s*/g, '>')         // Trim whitespace after tags
    .replace(/"\s+/g, '"')         // Clean attribute spacing
    .replace(/\s+"/g, '"')
    .toLowerCase(), "hex")
