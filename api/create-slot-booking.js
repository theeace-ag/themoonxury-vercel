const { razorpay, uuidv4 } = require('./_utils');
const db = require('./_store');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { name, peopleCount, email, phone } = req.body;

        if (!name || !peopleCount || !email || !phone) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        const amount = 50; // Fixed slot confirmation fee

        const order = await razorpay.orders.create({
            amount: amount * 100,
            currency: 'INR',
            receipt: uuidv4(),
            notes: { name, email, phone, type: 'slot_booking' }
        });

        await db.createSlotBooking({
            name,
            peopleCount,
            email,
            phone,
            amount,
            orderId: order.id,
            paymentStatus: 'pending'
        });

        res.status(200).json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error('Slot booking error:', error);
        res.status(500).json({ error: 'Failed to initiate booking' });
    }
};
