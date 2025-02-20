// server.js
import express from 'express';
import { scrapeSchools } from './scraper.js';

const app = express();
app.use(express.json());

app.post('/scrape', async (req, res) => {
    try {
        const { divisionCode } = req.body;
        const results = await scrapeSchools(divisionCode);

        res.json({
            divisionCode,
            schools: results,
            totalPages: results[0]?.totalPages || 1
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});