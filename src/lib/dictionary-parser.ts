export interface DefectEntry {
    category: string;
    id: string;
    defect: string;
    majorDefectCategory: string;
    description: string;
    visualPatterns: string;
}

export interface DictionaryParseResult {
    entries: DefectEntry[];
    totalPages: number;
}

export interface ProgressCallback {
    (currentPage: number, totalPages: number): void;
}

/**
 * Parse a single dictionary page HTML and extract defect entries
 */
export function parseDictionaryPage(html: string): {
    entries: DefectEntry[];
    totalPages: number;
} {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Extract entries from table rows
    const rows = doc.querySelectorAll("table.custom-table tbody tr");
    const entries: DefectEntry[] = [];

    rows.forEach((row) => {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 6) {
            entries.push({
                category: cells[0].textContent?.trim() || "",
                id: cells[1].textContent?.trim() || "",
                defect: cells[2].textContent?.trim() || "",
                majorDefectCategory: cells[3].textContent?.trim() || "",
                description: cells[4].textContent?.trim() || "",
                visualPatterns: cells[5].textContent?.trim() || "",
            });
        }
    });

    // Detect total pages from pagination
    const pageLinks = doc.querySelectorAll(".pagination .page-item a.page-link");
    let totalPages = 1;

    pageLinks.forEach((link) => {
        const text = link.textContent?.trim() || "";
        // Check if it's a numeric page link (not "Prev" or "Next")
        const pageNum = parseInt(text, 10);
        if (!isNaN(pageNum) && pageNum > totalPages) {
            totalPages = pageNum;
        }
    });

    return { entries, totalPages };
}

/**
 * Fetch all dictionary pages sequentially and parse them
 */
export async function fetchAllDictionaryPages(
    baseUrl: string,
    onProgress?: ProgressCallback
): Promise<DefectEntry[]> {
    const allEntries: DefectEntry[] = [];
    let totalPages = 1;
    let currentPage = 1;

    // Fetch first page to determine total pages
    const firstPageUrl = `${baseUrl}?page=1&search=&category=`;
    const firstPageResponse = await fetch(firstPageUrl);
    if (!firstPageResponse.ok) {
        throw new Error(`Failed to fetch dictionary: ${firstPageResponse.statusText}`);
    }

    const firstPageHtml = await firstPageResponse.text();
    const firstPageResult = parseDictionaryPage(firstPageHtml);
    allEntries.push(...firstPageResult.entries);
    totalPages = firstPageResult.totalPages;

    if (onProgress) {
        onProgress(1, totalPages);
    }

    // Fetch remaining pages
    for (currentPage = 2; currentPage <= totalPages; currentPage++) {
        const pageUrl = `${baseUrl}?page=${currentPage}&search=&category=`;
        const response = await fetch(pageUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch page ${currentPage}: ${response.statusText}`);
        }

        const html = await response.text();
        const result = parseDictionaryPage(html);
        allEntries.push(...result.entries);

        if (onProgress) {
            onProgress(currentPage, totalPages);
        }
    }

    return allEntries;
}
