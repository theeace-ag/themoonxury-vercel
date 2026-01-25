const db = require('./_store');
const QRCode = require('qrcode');

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Get ticket number from query or path
        const { ticketNumber } = req.query;

        if (!ticketNumber) {
            return res.status(400).json({ error: 'Ticket number required' });
        }

        const registration = await db.getRegistrationByTicket(ticketNumber);
        if (!registration || registration.payment_status !== 'completed') {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const qrData = JSON.stringify({
            ticket: registration.ticket_number,
            name: registration.name,
            event: 'MOONXURY 2025',
            date: '25 Feb 2025'
        });
        const qrCodeDataURL = await QRCode.toDataURL(qrData, {
            width: 200,
            margin: 2
        });

        res.status(200).json({
            ticketNumber: registration.ticket_number,
            name: registration.name,
            email: registration.email,
            phone: registration.phone,
            qrCode: qrCodeDataURL,
            eventDate: '25 Feb 2025',
            eventTime: '7 PM Onwards',
            venue: 'Kolkata (Venue TBA)'
        });

    } catch (error) {
        console.error('Error fetching ticket:', error);
        res.status(500).json({ error: 'Failed to fetch ticket' });
    }
};
