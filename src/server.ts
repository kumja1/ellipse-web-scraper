// server.js
import express from 'express';
import { scrapeSchools } from './scraper.js';
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors())

app.post('/scrape', async (req, res) => {
    try {
        const { divisionCode } = req.body;
        const results = await scrapeSchools(divisionCode);

        res.json({
            divisionCode,
            schools: results,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));