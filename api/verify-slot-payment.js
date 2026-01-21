const crypto = require('crypto');
const db = require('./_store');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid signature' });
        }

        const booking = await db.getSlotBookingByOrderId(razorpay_order_id);
        if (!booking) return res.status(404).json({ error: 'Booking not found' });

        await db.updateSlotPaymentStatus(razorpay_order_id, razorpay_payment_id, 'completed');

        // Send confirmation email
        try {
            await sendSlotConfirmationEmail(booking);
        } catch (err) {
            console.error('Email error:', err);
        }

        res.status(200).json({ success: true });

    } catch (error) {
        console.error('Slot verification error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
};

async function sendSlotConfirmationEmail(booking) {
    const emailHtml = `
    <h2>Booking Confirmed!</h2>
    <p>Dear ${booking.name},</p>
    <p>Your slot for MOONXURY has been confirmed. Thank you for the payment of ₹${booking.amount}.</p>
    <p><strong>Please proceed to book your tickets now.</strong></p>
    <p><a href="https://themoonxury-vercel.vercel.app/" style="background:#000;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;">Book Tickets</a></p>
    `;

    await transporter.sendMail({
        from: `"MOONXURY" <${process.env.EMAIL_USER}>`,
        to: booking.email,
        subject: `✅ Slot Confirmed - MOONXURY`,
        html: emailHtml
    });
}
